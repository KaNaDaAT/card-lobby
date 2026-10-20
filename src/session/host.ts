/**
 * The host's side of a room. The host is authoritative: it keeps the members, lobby settings,
 * chat and the game, validates every intent, runs the engine, and sends each member a personal
 * view after every change. See docs/DESIGN.md, "Host-authoritative model".
 *
 * Everything that arrives from the network is untrusted and checked here before use.
 */
import { apply, startGame, viewFor } from '../engine/index';
import type { GameState, Input, Seat } from '../engine/types';
import { safeColor, type Identity } from '../identity';
import {
  ACTION,
  CHAT_COOLDOWNS,
  CHAT_HISTORY,
  CHAT_MAX_LENGTH,
  DEFAULT_CHAT_COOLDOWN,
  MAX_BYTES,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ChatPayload,
  type Hello,
  type Intent,
  type LobbyView,
  type PackReply,
  type PackStatus,
  type View,
} from '../net/protocol';
import type { Channel, Transport } from '../net/transport';
import { uploadProblems, withUploads } from '../packs/custom';
import { mergeAddons } from '../packs/merge';
import type { LoadedAddon, LoadedPack, OptionValue, Pack, PackOffer } from '../packs/types';
import { validateSelection } from '../packs/validate';
import { MAX_CARD_COUNT, MAX_SEATS, mergeSelection, optionValueOk, setupProblem, startBlocked, withTweaks, type Selection, type Tweaks } from './lobby';
import type { Session, SessionState } from './types';

export const NAME_MAX_LENGTH = 24;

export interface SnapshotStore {
  load(): string | null;
  save(data: string): void;
}

export interface HostOptions {
  code: string;
  me: Identity;
  transport: Transport;
  /** Games the host can pick: built-in ones and any uploaded before. */
  packs: LoadedPack[];
  /** Addons uploaded in their own zips before. Each joins the game it extends, if it fits. */
  addons?: LoadedAddon[];
  store?: SnapshotStore;
  now?: () => number;
  /** Seeds each game's PRNG. Random by default. */
  seed?: () => number;
  /** Timers for reaction windows. The page's setTimeout by default. */
  timers?: Timers;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const pageTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Member {
  playerId: string;
  name: string;
  color: string;
  /** Current connection, null while away. The host's own member always has one. */
  peerId: string | null;
  /** False for members restored from a save until they say hello again. */
  seen: boolean;
}

interface Game {
  packId: string;
  addons: string[];
  /** Card counts and seats the host picked, fixed when the game starts. */
  counts: Record<string, number>;
  seats: number | null;
  /** The merged pack the game runs on. Rebuilt from packId, addons, counts and seats on resume. */
  pack: Pack;
  state: GameState;
}

/** What the host saves after every change, so a reload resumes the room, even mid-game. */
interface Snapshot {
  v: 1;
  seq: number;
  chatCounter: number;
  members: Omit<Member, 'peerId' | 'seen'>[];
  packId: string | null;
  addons: string[];
  options: Record<string, OptionValue>;
  chat: ChatMessage[];
  /** Missing in saves from before slow mode, card counts and seats. */
  chatCooldown?: number;
  counts?: Record<string, number>;
  seats?: number | null;
  game: { packId: string; addons: string[]; counts?: Record<string, number>; seats?: number | null; state: GameState } | null;
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** How often the host sends one player the same pack, so a broken client cannot loop it. */
const MAX_TRANSFERS = 3;

/** Slow mode lets a message in this much early, since messages travel at different speeds. */
const CHAT_SLACK_MS = 300;

export class HostSession implements Session {
  readonly isHost = true;
  readonly playerId: string;

  private readonly code: string;
  private readonly transport: Transport;
  private packs: LoadedPack[];
  private readonly store: SnapshotStore | undefined;
  private readonly now: () => number;
  private readonly seed: () => number;
  private readonly timers: Timers;
  private readonly listeners = new Set<() => void>();
  private readonly out: { view: Channel<View>; chat: Channel<ChatPayload>; packOffer: Channel<PackOffer>; packData: Channel<Uint8Array> };
  private readonly validation = new Map<string, string[]>();

  private members: Member[];
  private packId: string | null = null;
  private addons: string[] = [];
  private options: Record<string, OptionValue> = {};
  /** Copies the host picked, by card id. Only changed cards are listed. */
  private counts: Record<string, number> = {};
  /** Seats the host picked, null for the game's own maximum. */
  private seats: number | null = null;
  private chat: ChatMessage[] = [];
  private game: Game | null = null;
  private seq = 0;
  private chatCounter = 0;
  private chatCooldown = DEFAULT_CHAT_COOLDOWN;
  /** When each member last chatted, host clock in ms, for slow mode. */
  private lastSaid = new Map<string, number>();
  private notices = 0;
  private ownView: View | null = null;
  /** Addons uploaded in their own zips, in upload order. */
  private uploads: LoadedAddon[] = [];
  /** Where each member stands with each custom file the lobby uses: playerId, then hash. */
  private fileStatus = new Map<string, Map<string, PackStatus>>();
  /** How often each member got each file, by `playerId|hash`. */
  private transfers = new Map<string, number>();
  /** The timer that closes the open reaction window, and when that window ends. */
  private windowTimer: { handle: unknown; endsAt: number } | null = null;

  constructor(opts: HostOptions) {
    this.code = opts.code;
    this.transport = opts.transport;
    this.packs = [...opts.packs];
    for (const upload of opts.addons ?? []) this.addAddon(upload, false);
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.seed = opts.seed ?? randomSeed;
    this.timers = opts.timers ?? pageTimers;
    this.playerId = opts.me.playerId;
    const self: Member = { ...pickIdentity(opts.me), peerId: opts.transport.selfId, seen: true };
    this.members = [self];

    const t = this.transport;
    this.out = {
      view: t.channel<View>(ACTION.view),
      chat: t.channel<ChatPayload>(ACTION.chat),
      packOffer: t.channel<PackOffer>(ACTION.packOffer),
      packData: t.channel<Uint8Array>(ACTION.packData),
    };
    // Nothing a client sends is big. Drop anything that is.
    const inbound = <T>(name: string, max: number) => {
      const ch = t.channel<T>(name);
      ch.guard((bytes) => bytes <= max);
      return ch;
    };
    t.channel<unknown>(ACTION.packData).guard(() => false);

    const saved = this.restore();
    if (saved) {
      this.members = [self, ...saved.members.filter((m) => m.playerId !== self.playerId).map((m) => ({ ...m, peerId: null, seen: false }))];
      this.packId = saved.packId;
      this.addons = saved.addons;
      this.options = saved.options;
      this.counts = saved.counts ?? {};
      this.seats = saved.seats ?? null;
      this.chat = saved.chat;
      this.seq = saved.seq;
      this.chatCounter = saved.chatCounter;
      if (CHAT_COOLDOWNS.includes(saved.chatCooldown ?? -1)) this.chatCooldown = saved.chatCooldown!;
      this.game = this.resumeGame(saved.game);
    } else {
      this.system('Lobby created. Share the link or code to invite friends.');
    }
    if (!this.loadedPack() && this.packs[0]) this.selectPack(this.packs[0].key);

    inbound<unknown>(ACTION.hello, MAX_BYTES.hello).onMessage((data, from) => this.onHello(data, from));
    inbound<unknown>(ACTION.say, MAX_BYTES.say).onMessage((data, from) => {
      const member = this.memberByPeer(from);
      if (member) this.addChat(member, data);
    });
    inbound<unknown>(ACTION.intent, MAX_BYTES.intent).onMessage((data, from) => {
      const member = this.memberByPeer(from);
      const intent = parseIntent(data);
      if (member && intent) this.handle(member, intent);
    });
    inbound<unknown>(ACTION.packReply, MAX_BYTES.packReply).onMessage((data, from) => {
      const member = this.memberByPeer(from);
      const reply = parsePackReply(data);
      if (member && reply) this.onPackReply(member, reply);
    });
    t.onPeerLeave((peerId) => this.onPeerLeave(peerId));

    this.broadcast();
  }

  // ---------- Session ----------

  state(): SessionState {
    const active = this.activePack();
    return {
      status: 'connected',
      view: this.ownView,
      chat: this.chat,
      customPack: active?.custom ? active : null,
      customAddons: active?.uploads ?? [],
      packOffers: [],
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  say(text: string): void {
    this.addChat(this.members[0]!, text);
  }

  act(intent: Intent): void {
    this.handle(this.members[0]!, intent);
  }

  answerPackOffer(): void {
    // The host already has every pack it offers.
  }

  availablePacks(): LoadedPack[] {
    return this.games();
  }

  /** Adds an uploaded pack to the gallery. Selecting it is up to the host. */
  addPack(lp: LoadedPack): void {
    if (this.packs.some((p) => p.key === lp.key)) return;
    this.packs.push(lp);
    this.notify();
  }

  /** Takes an uploaded pack out of the gallery, unless it is in use. */
  removePack(key: string): boolean {
    const lp = this.packs.find((p) => p.key === key);
    if (!lp?.custom || this.packId === key || this.game?.packId === key) return false;
    this.packs = this.packs.filter((p) => p !== lp);
    this.notify();
    return true;
  }

  /**
   * Adds an addon from its own zip to the game it extends. Returns why it cannot be added, or
   * an empty list. Turning it on is up to the host.
   */
  addAddon(upload: LoadedAddon, notify = true): string[] {
    if (this.uploads.some((u) => u.key === upload.key)) return [];
    const bases = this.packs.filter((p) => p.pack.id === upload.gameId);
    if (!bases.length) return [`${upload.addon.name} is an addon for the game "${upload.gameId}", which this lobby does not have.`];
    for (const base of bases) {
      const problems = uploadProblems(base, upload, this.uploads.filter((u) => u.gameId === upload.gameId));
      if (problems.length) return problems;
    }
    this.uploads.push(upload);
    if (notify) this.notify();
    return [];
  }

  /** Takes an uploaded addon away, unless the running game uses it. Turns it off first. */
  removeAddon(key: string): boolean {
    const upload = this.uploads.find((u) => u.key === key);
    if (!upload) return false;
    const inGame = this.game && this.activePack()?.uploads?.includes(upload) && this.game.addons.includes(upload.addon.id);
    if (inGame) return false;
    if (this.loadedPack()?.uploads?.includes(upload)) this.addons = this.addons.filter((id) => id !== upload.addon.id);
    this.uploads = this.uploads.filter((u) => u !== upload);
    this.broadcast();
    return true;
  }

  leave(): void {
    if (this.windowTimer) this.timers.clear(this.windowTimer.handle);
    this.windowTimer = null;
    this.transport.leave();
    this.listeners.clear();
  }

  // ---------- Network events ----------

  private onHello(data: unknown, peerId: string): void {
    const hello = parseHello(data);
    if (!hello) return;
    if (hello.protocol !== PROTOCOL_VERSION) {
      void this.out.view.send({ seq: 0, hostPlayerId: this.playerId, lobby: this.lobbyView(), game: null, outdated: true }, peerId);
      return;
    }
    // Our own identity in another tab of the same browser slot. It cannot be a second member.
    if (hello.playerId === this.playerId) return;

    let member = this.members.find((m) => m.playerId === hello.playerId);
    if (member) {
      // Reconnect, or a second connection with the same playerId: the newest wins.
      // After a host reload everyone reconnects, which is no news.
      const cameBack = member.peerId === null && member.seen;
      Object.assign(member, pickIdentity(hello), { peerId, seen: true });
      if (cameBack) this.system(`${member.name} is back.`);
    } else {
      member = { ...pickIdentity(hello), peerId, seen: true };
      this.members.push(member);
      this.system(this.game ? `${member.name} joined and is watching.` : `${member.name} joined.`);
    }
    this.syncConnection(member);
    // View first: clients lock onto the host by its first view and ignore chat before that.
    this.broadcast();
    void this.out.chat.send({ messages: this.chat, history: true }, peerId);
    // A fresh page has nothing custom loaded yet, even if it said yes before. Offer again.
    this.offerFiles(member);
  }

  private onPeerLeave(peerId: string): void {
    const member = this.memberByPeer(peerId);
    if (!member || member === this.members[0]) return;
    member.peerId = null;
    this.system(`${member.name} left.`);
    this.syncConnection(member);
    this.broadcast();
  }

  // ---------- Intents ----------

  private handle(from: Member, intent: Intent): void {
    const isHost = from === this.members[0];
    const inLobby = this.game === null;
    let changed = false;
    switch (intent.kind) {
      case 'selectPack':
        changed = isHost && inLobby && this.selectPack(intent.packId);
        break;
      case 'toggleAddon':
        changed = isHost && inLobby && this.toggleAddon(intent.addonId, intent.on);
        break;
      case 'setOption':
        changed = isHost && inLobby && this.setOption(intent.id, intent.value);
        break;
      case 'removePlayer':
        changed = isHost && this.removePlayer(intent.playerId);
        break;
      case 'start':
        changed = isHost && inLobby && this.start();
        break;
      case 'rematch':
        changed = isHost && this.game?.state.phase === 'gameOver' && this.start();
        break;
      case 'endGame':
        changed = isHost && this.endGame();
        break;
      case 'answer': {
        const seat = this.seatOf(from.playerId);
        changed = seat !== null && this.input({ kind: 'answer', seat, promptId: intent.promptId, value: intent.value, now: this.now() });
        break;
      }
      case 'react': {
        const seat = this.seatOf(from.playerId);
        changed = seat !== null && this.input({ kind: 'react', seat, uid: intent.uid, now: this.now() });
        break;
      }
      case 'nextRound':
        changed = isHost && this.input({ kind: 'nextRound' });
        break;
      case 'kickForRound': {
        const seat = this.seatOf(intent.playerId);
        changed = isHost && seat !== null && this.input({ kind: 'kickForRound', seat });
        break;
      }
      case 'assignSeat':
        changed = isHost && this.assignSeat(intent.seatOf, intent.to);
        break;
      case 'clearChat':
        changed = isHost && this.clearChat();
        break;
      case 'setChatCooldown':
        changed = isHost && this.setChatCooldown(intent.seconds);
        break;
      case 'setCardCount':
        changed = isHost && inLobby && this.setCardCount(intent.cardId, intent.count);
        break;
      case 'resetCardCounts':
        changed = isHost && inLobby && Object.keys(this.counts).length > 0;
        if (changed) this.counts = {};
        break;
      case 'setCardCounts':
        changed = isHost && inLobby && this.setCardCounts(intent.counts);
        break;
      case 'setSeats':
        changed = isHost && inLobby && this.setSeats(intent.seats);
        break;
    }
    if (changed) this.broadcast();
    if (changed && (intent.kind === 'selectPack' || (intent.kind === 'toggleAddon' && intent.on))) for (const m of this.members) this.offerFiles(m);
  }

  private selectPack(packId: string): boolean {
    if (!this.packs.some((p) => p.key === packId)) return false;
    this.packId = packId;
    this.addons = [];
    this.options = {};
    this.counts = {};
    this.seats = null;
    this.fileStatus.clear();
    this.transfers.clear();
    return true;
  }

  // ---------- Custom packs ----------

  /** Custom files the lobby uses and players need: the game, if uploaded, then uploaded addons that are on. */
  private neededFiles(): { offer: PackOffer; bytes: Uint8Array }[] {
    const lp = this.activePack();
    if (!lp) return [];
    const on = this.game?.addons ?? this.addons;
    const addons = (lp.uploads ?? []).filter((u) => on.includes(u.addon.id)).map((u) => u.custom);
    return [...(lp.custom ? [lp.custom] : []), ...addons];
  }

  private statusesOf(member: Member): Map<string, PackStatus> {
    let map = this.fileStatus.get(member.playerId);
    if (!map) this.fileStatus.set(member.playerId, (map = new Map()));
    return map;
  }

  /** Offers each custom file the lobby uses to a member. Someone who declined stays declined until they answer. */
  private offerFiles(member: Member): void {
    if (member === this.members[0] || !member.peerId) return;
    const statuses = this.statusesOf(member);
    for (const { offer } of this.neededFiles()) {
      if (statuses.get(offer.hash) !== 'declined') statuses.set(offer.hash, 'offered');
      void this.out.packOffer.send(offer, member.peerId);
    }
  }

  private onPackReply(member: Member, reply: PackReply): void {
    const file = this.neededFiles().find((f) => f.offer.hash === reply.hash);
    if (!file || member === this.members[0] || !member.peerId) return;
    const statuses = this.statusesOf(member);
    if (reply.accept && reply.cached) {
      statuses.set(reply.hash, 'ready');
    } else if (reply.accept) {
      // One transfer at a time per player, and only a few of each file.
      const key = `${member.playerId}|${reply.hash}`;
      const sent = this.transfers.get(key) ?? 0;
      if ([...statuses.values()].includes('downloading') || sent >= MAX_TRANSFERS) return;
      this.transfers.set(key, sent + 1);
      statuses.set(reply.hash, 'downloading');
      void this.out.packData.send(file.bytes, member.peerId);
    } else {
      statuses.set(reply.hash, reply.error ? 'failed' : 'declined');
      if (reply.error) this.system(`${member.name} could not load ${file.offer.name}: ${reply.error}`);
    }
    this.broadcast();
  }

  /** One status for all the custom files a member needs: the least ready one counts. */
  private packStatusOf(member: Member): PackStatus {
    const files = this.neededFiles();
    if (member === this.members[0] || !files.length) return 'ready';
    const statuses = this.fileStatus.get(member.playerId);
    const all = files.map((f) => statuses?.get(f.offer.hash) ?? 'offered');
    for (const status of ['failed', 'declined', 'downloading', 'offered'] as const) if (all.includes(status)) return status;
    return 'ready';
  }

  private toggleAddon(addonId: string, on: boolean): boolean {
    const lp = this.loadedPack();
    if (!lp || !lp.addons.some((a) => a.id === addonId)) return false;
    const next = this.addons.filter((id) => id !== addonId);
    if (on) next.push(addonId);
    if (mergeSelection(lp, next).problems.length) return false;
    this.addons = next;
    // Options an addon brought along may be gone now, and so may cards.
    const defs = this.selection()?.pack?.options ?? [];
    for (const id of Object.keys(this.options)) {
      const def = defs.find((d) => d.id === id);
      if (!def || !optionValueOk(def, this.options[id])) delete this.options[id];
    }
    const base = this.basePack();
    for (const [id, count] of Object.entries(this.counts)) {
      const card = base?.cards.find((c) => c.id === id);
      if (typeof card?.count !== 'number' || card.count === count) delete this.counts[id];
    }
    if (this.seats !== null && (!base || this.seats < base.players.min || this.seats === base.players.max)) this.seats = null;
    return true;
  }

  /** The picked game and addons as the pack has them, before the host's changes. */
  private basePack(): Pack | null {
    const lp = this.loadedPack();
    return (lp && mergeSelection(lp, this.addons).pack) ?? null;
  }

  private tweaks(): Tweaks {
    return { counts: this.counts, seats: this.seats };
  }

  private setCardCount(cardId: string, count: number): boolean {
    const card = this.basePack()?.cards.find((c) => c.id === cardId);
    if (typeof card?.count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_CARD_COUNT) return false;
    if (count === (this.counts[cardId] ?? card.count)) return false;
    if (count === card.count) delete this.counts[cardId];
    else this.counts[cardId] = count;
    return true;
  }

  /** Replaces every count, like loading a preset. Cards the game lacks or cannot change are skipped. */
  private setCardCounts(counts: Record<string, number>): boolean {
    const next: Record<string, number> = {};
    for (const card of this.basePack()?.cards ?? []) {
      const count = counts[card.id];
      if (typeof card.count !== 'number' || count === undefined || count === card.count) continue;
      if (Number.isInteger(count) && count >= 0 && count <= MAX_CARD_COUNT) next[card.id] = count;
    }
    const key = (c: Record<string, number>) => JSON.stringify(Object.entries(c).sort());
    if (key(next) === key(this.counts)) return false;
    this.counts = next;
    return true;
  }

  /** Seats at the table, from the game's minimum up to MAX_SEATS. The game's own maximum means null. */
  private setSeats(seats: number | null): boolean {
    const base = this.basePack();
    if (!base) return false;
    const next = seats === base.players.max ? null : seats;
    if (next !== null && (!Number.isInteger(next) || next < base.players.min || next > MAX_SEATS)) return false;
    if (next === this.seats) return false;
    this.seats = next;
    return true;
  }

  private setOption(id: string, value: OptionValue): boolean {
    const def = this.selection()?.pack?.options?.find((d) => d.id === id);
    if (!def || !optionValueOk(def, value)) return false;
    this.options[id] = value;
    return true;
  }

  /** Removes an away member. Seated players of a running game are kicked for the round instead. */
  private removePlayer(playerId: string): boolean {
    const i = this.members.findIndex((m) => m.playerId === playerId);
    if (i <= 0 || this.members[i]!.peerId !== null || this.seatOf(playerId) !== null) return false;
    const [gone] = this.members.splice(i, 1);
    this.system(`${gone!.name} was removed.`);
    return true;
  }

  /** Starts a game, or a rematch with the current lobby. */
  private start(): boolean {
    const lp = this.loadedPack();
    const selection = this.selection();
    const seated = this.seated(selection);
    if (!lp || !selection?.pack || this.startProblem(selection, seated)) return false;
    const state = startGame(
      selection.pack,
      {
        packId: lp.pack.id,
        players: seated.map((m) => ({ playerId: m.playerId, name: m.name, color: m.color })),
        options: this.options,
        seed: this.seed(),
      },
      this.now(),
    );
    this.game = { packId: lp.key, addons: [...this.addons], counts: { ...this.counts }, seats: this.seats, pack: selection.pack, state };
    this.system(`The game begins: ${selection.pack.name}.`);
    return true;
  }

  /** Back to the lobby, after the game or in the middle of it. */
  private endGame(): boolean {
    if (!this.game) return false;
    const early = this.game.state.phase !== 'gameOver';
    this.game = null;
    this.system(early ? 'The host ended the game. Back to the lobby.' : 'Back to the lobby.');
    return true;
  }

  /** Runs an engine input. Refused inputs change nothing. */
  private input(input: Input): boolean {
    if (!this.game) return false;
    const result = apply(this.game.pack, this.game.state, input);
    if (result.error) {
      if (result.error.startsWith('Engine error')) this.system(result.error);
      return false;
    }
    this.game.state = result.state;
    return true;
  }

  /** Gives the seat of an away player to a member who is not seated (someone switched device). */
  private assignSeat(seatOfId: string, toId: string): boolean {
    const game = this.game;
    const seat = this.seatOf(seatOfId);
    const old = this.members.find((m) => m.playerId === seatOfId);
    const next = this.members.find((m) => m.playerId === toId);
    if (!game || seat === null || !old || !next || old.peerId !== null || this.seatOf(toId) !== null) return false;
    const player = game.state.players[seat]!;
    Object.assign(player, { playerId: next.playerId, name: next.name, color: next.color });
    // The new device takes the old member's place in the list, so the seat order stays.
    const i = this.members.indexOf(old);
    this.members.splice(this.members.indexOf(next), 1);
    this.members.splice(i, 1, next);
    this.members.push(old);
    this.syncConnection(next);
    this.system(`${next.name} takes over ${old.name}'s seat.`);
    return true;
  }

  /** Tells the engine whether a seated member is connected. */
  private syncConnection(member: Member): void {
    const seat = this.seatOf(member.playerId);
    if (seat === null || !this.game) return;
    const connected = member.peerId !== null;
    if (this.game.state.players[seat]!.connected !== connected) this.input({ kind: 'connection', seat, connected });
  }

  // ---------- Chat ----------

  private addChat(from: Member, raw: unknown): void {
    if (typeof raw !== 'string') return;
    const text = raw.trim().slice(0, CHAT_MAX_LENGTH);
    if (!text || this.tooSoon(from)) return;
    this.pushChat({ id: this.nextChatId(), from: from.playerId, name: from.name, text, at: this.now() });
    this.save();
    this.notify();
  }

  /** Slow mode. A message that comes too soon is dropped, and only its sender hears why. */
  private tooSoon(from: Member): boolean {
    if (from === this.members[0] || !this.chatCooldown) return false;
    const now = this.now();
    const last = this.lastSaid.get(from.playerId);
    if (last !== undefined && now - last < this.chatCooldown * 1000 - CHAT_SLACK_MS) {
      const text = `Slow mode: one message every ${this.chatCooldown} seconds.`;
      if (from.peerId) void this.out.chat.send({ messages: [{ id: `n${now}-${++this.notices}`, from: 'system', name: '', text, at: now }] }, from.peerId);
      return true;
    }
    this.lastSaid.set(from.playerId, now);
    return false;
  }

  /** Empties the chat for everyone. Clients replace what they have with the new history. */
  private clearChat(): boolean {
    this.chat = [{ id: this.nextChatId(), from: 'system', name: '', text: 'The host cleared the chat.', at: this.now() }];
    for (const m of this.members) {
      if (m.peerId && m !== this.members[0]) void this.out.chat.send({ messages: this.chat, history: true }, m.peerId);
    }
    return true;
  }

  private setChatCooldown(seconds: number): boolean {
    if (!CHAT_COOLDOWNS.includes(seconds) || seconds === this.chatCooldown) return false;
    this.chatCooldown = seconds;
    this.system(seconds ? `Slow mode: one message every ${seconds} seconds.` : 'Slow mode is off.');
    return true;
  }

  private system(text: string): void {
    this.pushChat({ id: this.nextChatId(), from: 'system', name: '', text, at: this.now() });
  }

  private pushChat(msg: ChatMessage): void {
    this.chat = [...this.chat, msg].slice(-CHAT_HISTORY);
    for (const m of this.members) {
      if (m.peerId && m !== this.members[0]) void this.out.chat.send({ messages: [msg] }, m.peerId);
    }
  }

  private nextChatId(): string {
    return `m${++this.chatCounter}`;
  }

  // ---------- Views ----------

  /** Every game, each with the addons uploaded for it. */
  private games(): LoadedPack[] {
    return this.packs.map((lp) => withUploads(lp, this.uploads.filter((u) => u.gameId === lp.pack.id)));
  }

  private loadedPack(): LoadedPack | undefined {
    return this.games().find((p) => p.key === this.packId);
  }

  /** The pack in use: the running game's, or the one picked in the lobby. */
  private activePack(): LoadedPack | undefined {
    const key = this.game?.packId ?? this.packId;
    return this.games().find((p) => p.key === key);
  }

  private selection(): Selection | null {
    const lp = this.loadedPack();
    return lp ? mergeSelection(lp, this.addons, this.tweaks()) : null;
  }

  /** Members who would get a seat if the game started now, in seat order. Who declined the pack watches. */
  private seated(selection: Selection | null): Member[] {
    const max = selection?.pack?.players.max ?? this.members.length;
    const status = (m: Member) => this.packStatusOf(m);
    return this.members.filter((m) => status(m) !== 'declined' && status(m) !== 'failed').slice(0, max);
  }

  private seatOf(playerId: string): Seat | null {
    const seat = this.game?.state.players.findIndex((p) => p.playerId === playerId) ?? -1;
    return seat >= 0 ? seat : null;
  }

  /**
   * Validation errors for the current selection, cached per pack and addon set. Changed card
   * counts and extra seats are checked for the players who would sit down.
   */
  private packProblems(selection: Selection | null, players: number): string[] {
    const lp = this.loadedPack();
    if (!lp) return [];
    const uploads = (lp.uploads ?? []).map((u) => u.key).join(',');
    const key = `${lp.key}|${uploads}|${[...this.addons].sort().join(',')}`;
    let errors = this.validation.get(key);
    if (!errors) {
      errors = validateSelection(lp, this.addons);
      this.validation.set(key, errors);
    }
    if (errors.length) return [`This game has a problem. ${errors[0]}`];
    const counted = Object.keys(this.counts).length > 0;
    const extraSeats = this.seats !== null && this.seats > (this.basePack()?.players.max ?? Infinity);
    if ((!counted && !extraSeats) || !selection?.pack) return [];
    const tweaksKey = `${key}|${JSON.stringify(this.tweaks())}|${players}`;
    let problems = this.validation.get(tweaksKey);
    if (!problems) {
      const problem = setupProblem(selection.pack, players, counted ? 'these card counts' : null);
      problems = problem ? [problem] : [];
      this.validation.set(tweaksKey, problems);
    }
    return problems;
  }

  private startProblem(selection: Selection | null, seated: Member[]): string | null {
    return startBlocked(
      selection,
      seated.map((m) => ({ playerId: m.playerId, name: m.name, connected: m.peerId !== null, packReady: this.packStatusOf(m) === 'ready' })),
      this.packProblems(selection, seated.length),
    );
  }

  /** Why the host cannot start the next round right now, or null. */
  private nextRoundProblem(state: GameState): string | null {
    if (state.phase !== 'roundOver') return null;
    const pool = state.deciding ?? state.players.map((p) => p.seat);
    const away = pool.filter((seat) => !state.players[seat]!.connected).map((seat) => state.players[seat]!.name);
    if ((state.deciding && away.length) || pool.length - away.length < 2) return `Waiting for ${away.join(' and ')} to come back.`;
    return null;
  }

  private lobbyView(): LobbyView {
    const game = this.game;
    const selection = this.selection();
    const seated = new Set(game ? game.state.players.map((p) => p.playerId) : this.seated(selection).map((m) => m.playerId));
    return {
      code: this.code,
      hostPlayerId: this.playerId,
      phase: game ? 'playing' : 'lobby',
      players: this.members.map((m) => ({
        playerId: m.playerId,
        name: m.name,
        color: m.color,
        connected: m.peerId !== null,
        isHost: m === this.members[0],
        role: seated.has(m.playerId) ? 'player' : 'spectator',
        pack: this.packStatusOf(m),
      })),
      packId: game?.packId ?? this.packId,
      addons: [...(game?.addons ?? this.addons)],
      options: game ? { ...game.state.options } : { ...this.options },
      customPack: this.activePack()?.custom?.offer ?? null,
      customAddons: this.neededFiles()
        .map((f) => f.offer)
        .filter((o) => o.kind === 'addon'),
      startBlocked: game ? this.nextRoundProblem(game.state) : this.startProblem(selection, this.seated(selection)),
      chatCooldown: this.chatCooldown,
      counts: { ...(game?.counts ?? this.counts) },
      seats: game ? game.seats : this.seats,
    };
  }

  /**
   * Keeps one timer on the open reaction window. When it fires, the window closes and the play
   * resolves. A reaction moves the end, so the timer follows it.
   */
  private scheduleWindow(): void {
    const endsAt = this.game?.state.stack.at(-1)?.endsAt ?? null;
    if (this.windowTimer?.endsAt === endsAt) return;
    if (this.windowTimer) this.timers.clear(this.windowTimer.handle);
    this.windowTimer = null;
    if (endsAt === null) return;
    const handle = this.timers.set(() => {
      this.windowTimer = null;
      if (this.input({ kind: 'timeout', now: Math.max(this.now(), endsAt) })) this.broadcast();
      else this.scheduleWindow();
    }, Math.max(0, endsAt - this.now()));
    this.windowTimer = { handle, endsAt };
  }

  /** Sends every connected member a fresh view and saves. */
  private broadcast(): void {
    this.seq++;
    this.scheduleWindow();
    const lobby = this.lobbyView();
    const now = this.now();
    for (const m of this.members) {
      const game = this.game ? viewFor(this.game.state, this.seatOf(m.playerId), now) : null;
      const view: View = { seq: this.seq, hostPlayerId: this.playerId, lobby, game };
      if (m === this.members[0]) this.ownView = view;
      else if (m.peerId) void this.out.view.send(view, m.peerId);
    }
    this.save();
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private memberByPeer(peerId: string): Member | undefined {
    return this.members.find((m) => m.peerId === peerId);
  }

  // ---------- Persistence ----------

  private save(): void {
    if (!this.store) return;
    const game = this.game;
    const snapshot: Snapshot = {
      v: 1,
      seq: this.seq,
      chatCounter: this.chatCounter,
      members: this.members.map(({ playerId, name, color }) => ({ playerId, name, color })),
      packId: this.packId,
      addons: this.addons,
      options: this.options,
      chat: this.chat,
      chatCooldown: this.chatCooldown,
      counts: this.counts,
      seats: this.seats,
      game: game ? { packId: game.packId, addons: game.addons, counts: game.counts, seats: game.seats, state: game.state } : null,
    };
    this.store.save(JSON.stringify(snapshot));
  }

  private restore(): Snapshot | null {
    try {
      const raw = this.store?.load();
      const snap = raw ? (JSON.parse(raw) as Snapshot) : null;
      return snap && snap.v === 1 && Array.isArray(snap.members) && Array.isArray(snap.chat) ? snap : null;
    } catch {
      return null;
    }
  }

  /** Rebuilds a saved game. Everyone but the host counts as away until they say hello. */
  private resumeGame(saved: Snapshot['game'] | undefined): Game | null {
    const lp = saved && this.games().find((p) => p.key === saved.packId);
    // A game whose uploaded addon is gone cannot go on.
    if (!saved || !lp || !saved.addons.every((id) => lp.addons.some((a) => a.id === id))) return null;
    try {
      const tweaks: Tweaks = { counts: saved.counts ?? {}, seats: saved.seats ?? null };
      const game: Game = { ...saved, ...tweaks, pack: withTweaks(mergeAddons(lp.pack, lp.addons, saved.addons), tweaks) };
      for (const p of game.state.players) p.connected = p.playerId === this.playerId;
      return game;
    } catch {
      return null;
    }
  }
}

// ---------- Untrusted input ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function pickIdentity(src: { playerId: string; name: string; color: string }) {
  return {
    playerId: src.playerId,
    name: src.name.trim().slice(0, NAME_MAX_LENGTH) || 'Player',
    color: safeColor(src.color),
  };
}

export function parseHello(data: unknown): Hello | null {
  if (!isObj(data)) return null;
  const { protocol, playerId, name, color, cachedPacks } = data;
  if (typeof protocol !== 'number' || !isStr(playerId, 64) || typeof name !== 'string' || typeof color !== 'string') {
    return null;
  }
  const packs = Array.isArray(cachedPacks) ? cachedPacks.filter((h): h is string => isStr(h, 128)).slice(0, 100) : [];
  return { protocol, playerId, name: name.slice(0, 200), color, cachedPacks: packs };
}

function parsePackReply(data: unknown): PackReply | null {
  if (!isObj(data) || !isStr(data.hash, 64) || typeof data.accept !== 'boolean') return null;
  return {
    hash: data.hash,
    accept: data.accept,
    cached: data.cached === true,
    ...(isStr(data.error, 300) ? { error: data.error } : {}),
  };
}

/** Answers are checked against the open prompt by the engine. Here only their size is capped. */
const smallJson = (v: unknown) => {
  try {
    return JSON.stringify(v).length <= 2000;
  } catch {
    return false;
  }
};

export function parseIntent(data: unknown): Intent | null {
  if (!isObj(data) || typeof data.kind !== 'string') return null;
  const d = data;
  switch (d.kind) {
    case 'selectPack':
      return isStr(d.packId) ? { kind: 'selectPack', packId: d.packId } : null;
    case 'toggleAddon':
      return isStr(d.addonId) && typeof d.on === 'boolean' ? { kind: 'toggleAddon', addonId: d.addonId, on: d.on } : null;
    case 'setOption': {
      const v = d.value;
      const okValue = typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 200);
      return isStr(d.id) && okValue ? { kind: 'setOption', id: d.id, value: v } : null;
    }
    case 'start':
    case 'nextRound':
    case 'rematch':
    case 'endGame':
    case 'clearChat':
      return { kind: d.kind };
    case 'setChatCooldown':
      return typeof d.seconds === 'number' && CHAT_COOLDOWNS.includes(d.seconds) ? { kind: 'setChatCooldown', seconds: d.seconds } : null;
    case 'setCardCount':
      return isStr(d.cardId) && typeof d.count === 'number' ? { kind: 'setCardCount', cardId: d.cardId, count: d.count } : null;
    case 'resetCardCounts':
      return { kind: d.kind };
    case 'setCardCounts': {
      const entries = isObj(d.counts) ? Object.entries(d.counts) : [];
      const ok = entries.length <= 200 && entries.every(([id, n]) => isStr(id, 64) && typeof n === 'number');
      return isObj(d.counts) && ok ? { kind: 'setCardCounts', counts: Object.fromEntries(entries) as Record<string, number> } : null;
    }
    case 'setSeats':
      return d.seats === null || typeof d.seats === 'number' ? { kind: 'setSeats', seats: d.seats } : null;
    case 'react':
      return isStr(d.uid, 64) ? { kind: 'react', uid: d.uid } : null;
    case 'answer':
      return isStr(d.promptId) && smallJson(d.value) ? { kind: 'answer', promptId: d.promptId, value: d.value } : null;
    case 'kickForRound':
    case 'removePlayer':
      return isStr(d.playerId, 64) ? { kind: d.kind, playerId: d.playerId } : null;
    case 'assignSeat':
      return isStr(d.seatOf, 64) && isStr(d.to, 64) ? { kind: 'assignSeat', seatOf: d.seatOf, to: d.to } : null;
    default:
      return null;
  }
}

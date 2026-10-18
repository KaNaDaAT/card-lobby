/**
 * The host's side of a room. The host is authoritative: it keeps the members, lobby settings,
 * chat and (from milestone 2) the game, validates every intent, and sends each member a
 * personal view after every change. See docs/DESIGN.md, "Host-authoritative model".
 *
 * Everything that arrives from the network is untrusted and checked here before use.
 */
import { safeColor, type Identity } from '../identity';
import {
  ACTION,
  CHAT_HISTORY,
  CHAT_MAX_LENGTH,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ChatPayload,
  type Hello,
  type Intent,
  type LobbyView,
  type View,
} from '../net/protocol';
import type { Channel, Transport } from '../net/transport';
import type { LoadedPack, OptionValue } from '../packs/types';
import { mergeSelection, optionValueOk, startBlocked, type Selection } from './lobby';
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
  /** Games the host can pick. Built-in packs for now. */
  packs: LoadedPack[];
  store?: SnapshotStore;
  now?: () => number;
}

interface Member {
  playerId: string;
  name: string;
  color: string;
  /** Current connection, null while away. The host's own member always has one. */
  peerId: string | null;
  /** False for members restored from a save until they say hello again. */
  seen: boolean;
}

/** What the host saves after every change, so a reload resumes the room. */
interface Snapshot {
  v: 1;
  seq: number;
  chatCounter: number;
  members: Omit<Member, 'peerId' | 'seen'>[];
  packId: string | null;
  addons: string[];
  options: Record<string, OptionValue>;
  chat: ChatMessage[];
}

export class HostSession implements Session {
  readonly isHost = true;
  readonly playerId: string;

  private readonly code: string;
  private readonly transport: Transport;
  private readonly packs: LoadedPack[];
  private readonly store: SnapshotStore | undefined;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly out: { view: Channel<View>; chat: Channel<ChatPayload> };

  private members: Member[];
  private packId: string | null = null;
  private addons: string[] = [];
  private options: Record<string, OptionValue> = {};
  private chat: ChatMessage[] = [];
  private seq = 0;
  private chatCounter = 0;
  private ownView: View | null = null;

  constructor(opts: HostOptions) {
    this.code = opts.code;
    this.transport = opts.transport;
    this.packs = opts.packs;
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.playerId = opts.me.playerId;
    const self: Member = { ...pickIdentity(opts.me), peerId: opts.transport.selfId, seen: true };
    this.members = [self];

    const t = this.transport;
    this.out = { view: t.channel<View>(ACTION.view), chat: t.channel<ChatPayload>(ACTION.chat) };

    const saved = this.restore();
    if (saved) {
      this.members = [self, ...saved.members.filter((m) => m.playerId !== self.playerId).map((m) => ({ ...m, peerId: null, seen: false }))];
      this.packId = saved.packId;
      this.addons = saved.addons;
      this.options = saved.options;
      this.chat = saved.chat;
      this.seq = saved.seq;
      this.chatCounter = saved.chatCounter;
    } else {
      this.system('Lobby created. Share the link or code to invite friends.');
    }
    if (!this.loadedPack() && this.packs[0]) this.selectPack(this.packs[0].pack.id);

    t.channel<unknown>(ACTION.hello).onMessage((data, from) => this.onHello(data, from));
    t.channel<unknown>(ACTION.say).onMessage((data, from) => {
      const member = this.memberByPeer(from);
      if (member) this.addChat(member, data);
    });
    t.channel<unknown>(ACTION.intent).onMessage((data, from) => {
      const member = this.memberByPeer(from);
      const intent = parseIntent(data);
      if (member && intent) this.handle(member, intent);
    });
    t.onPeerLeave((peerId) => this.onPeerLeave(peerId));

    this.broadcast();
  }

  // ---------- Session ----------

  state(): SessionState {
    return { status: 'connected', view: this.ownView, chat: this.chat };
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

  leave(): void {
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
      this.system(`${member.name} joined.`);
    }
    // View first: clients lock onto the host by its first view and ignore chat before that.
    this.broadcast();
    void this.out.chat.send({ messages: this.chat, history: true }, peerId);
  }

  private onPeerLeave(peerId: string): void {
    const member = this.memberByPeer(peerId);
    if (!member || member === this.members[0]) return;
    member.peerId = null;
    this.system(`${member.name} left.`);
    this.broadcast();
  }

  // ---------- Intents ----------

  private handle(from: Member, intent: Intent): void {
    const isHost = from === this.members[0];
    let changed = false;
    switch (intent.kind) {
      case 'selectPack':
        changed = isHost && this.selectPack(intent.packId);
        break;
      case 'toggleAddon':
        changed = isHost && this.toggleAddon(intent.addonId, intent.on);
        break;
      case 'setOption':
        changed = isHost && this.setOption(intent.id, intent.value);
        break;
      case 'removePlayer':
        changed = isHost && this.removePlayer(intent.playerId);
        break;
      default:
        // Game intents arrive with the engine (milestone 2).
        break;
    }
    if (changed) this.broadcast();
  }

  private selectPack(packId: string): boolean {
    if (!this.packs.some((p) => p.pack.id === packId)) return false;
    this.packId = packId;
    this.addons = [];
    this.options = {};
    return true;
  }

  private toggleAddon(addonId: string, on: boolean): boolean {
    const lp = this.loadedPack();
    if (!lp || !lp.addons.some((a) => a.id === addonId)) return false;
    const next = this.addons.filter((id) => id !== addonId);
    if (on) next.push(addonId);
    if (mergeSelection(lp, next).problems.length) return false;
    this.addons = next;
    // Options an addon brought along may be gone now.
    const defs = this.selection()?.pack?.options ?? [];
    for (const id of Object.keys(this.options)) {
      const def = defs.find((d) => d.id === id);
      if (!def || !optionValueOk(def, this.options[id])) delete this.options[id];
    }
    return true;
  }

  private setOption(id: string, value: OptionValue): boolean {
    const def = this.selection()?.pack?.options?.find((d) => d.id === id);
    if (!def || !optionValueOk(def, value)) return false;
    this.options[id] = value;
    return true;
  }

  private removePlayer(playerId: string): boolean {
    const i = this.members.findIndex((m) => m.playerId === playerId);
    if (i <= 0 || this.members[i]!.peerId !== null) return false;
    const [gone] = this.members.splice(i, 1);
    this.system(`${gone!.name} was removed.`);
    return true;
  }

  // ---------- Chat ----------

  private addChat(from: Member, raw: unknown): void {
    if (typeof raw !== 'string') return;
    const text = raw.trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    this.pushChat({ id: this.nextChatId(), from: from.playerId, name: from.name, text, at: this.now() });
    this.save();
    this.notify();
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

  private loadedPack(): LoadedPack | undefined {
    return this.packs.find((p) => p.pack.id === this.packId);
  }

  private selection(): Selection | null {
    const lp = this.loadedPack();
    return lp ? mergeSelection(lp, this.addons) : null;
  }

  /** Members who would get a seat if the game started now, in seat order. */
  private seated(selection: Selection | null): Member[] {
    const max = selection?.pack?.players.max ?? this.members.length;
    return this.members.slice(0, max);
  }

  private lobbyView(): LobbyView {
    const selection = this.selection();
    const seated = new Set(this.seated(selection));
    return {
      code: this.code,
      hostPlayerId: this.playerId,
      phase: 'lobby',
      players: this.members.map((m) => ({
        playerId: m.playerId,
        name: m.name,
        color: m.color,
        connected: m.peerId !== null,
        isHost: m === this.members[0],
        role: seated.has(m) ? 'player' : 'spectator',
        packReady: true,
      })),
      packId: this.packId,
      addons: [...this.addons],
      options: { ...this.options },
      customPack: null,
      startBlocked: startBlocked(
        selection,
        [...seated].map((m) => ({ playerId: m.playerId, name: m.name, connected: m.peerId !== null })),
      ),
    };
  }

  /** Sends every connected member a fresh view and saves. */
  private broadcast(): void {
    this.seq++;
    const lobby = this.lobbyView();
    for (const m of this.members) {
      const view: View = { seq: this.seq, hostPlayerId: this.playerId, lobby, game: null };
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
    const snapshot: Snapshot = {
      v: 1,
      seq: this.seq,
      chatCounter: this.chatCounter,
      members: this.members.map(({ playerId, name, color }) => ({ playerId, name, color })),
      packId: this.packId,
      addons: this.addons,
      options: this.options,
      chat: this.chat,
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
      return { kind: d.kind };
    case 'answer':
      return isStr(d.promptId) ? { kind: 'answer', promptId: d.promptId, value: d.value } : null;
    case 'kickForRound':
    case 'removePlayer':
      return isStr(d.playerId, 64) ? { kind: d.kind, playerId: d.playerId } : null;
    case 'assignSeat':
      return isStr(d.seatOf, 64) && isStr(d.to, 64) ? { kind: 'assignSeat', seatOf: d.seatOf, to: d.to } : null;
    default:
      return null;
  }
}

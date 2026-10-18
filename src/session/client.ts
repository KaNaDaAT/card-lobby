/**
 * A joining player's side of a room. It says hello to every peer, locks onto the first peer
 * that answers with a view, keeps the newest view by `seq`, and sends intents to the host.
 * Clients never run game rules. See docs/DESIGN.md, "Identity, host lock and reconnects".
 *
 * Custom packs and addons: the host offers each file the lobby uses, the client loads each from
 * its cache or asks the player once for all of them, downloads them one at a time, checks
 * each hash and its contents, and tells the host when each is ready. See docs/DESIGN.md,
 * "Custom packs".
 */
import type { Identity } from '../identity';
import {
  ACTION,
  CHAT_HISTORY,
  MAX_BYTES,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ChatPayload,
  type Hello,
  type Intent,
  type PackReply,
  type View,
} from '../net/protocol';
import type { Channel, Transport } from '../net/transport';
import { MAX_PACK_BYTES, PackImportError, type Imported } from '../packs/custom';
import type { PackLoader } from '../packs/loader';
import type { LoadedAddon, LoadedPack, PackOffer } from '../packs/types';
import type { PackOfferState, Session, SessionState, SessionStatus } from './types';

export interface ClientOptions {
  code: string;
  me: Identity;
  transport: Transport;
  /** Where custom packs come from. Without one, custom packs cannot be loaded. */
  packs?: PackLoader;
}

export class ClientSession implements Session {
  readonly isHost = false;
  readonly playerId: string;

  private readonly code: string;
  private readonly me: Identity;
  private readonly transport: Transport;
  private readonly loader: PackLoader | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly out: { hello: Channel<Hello>; say: Channel<string>; intent: Channel<Intent>; packReply: Channel<PackReply> };

  private status: SessionStatus = 'connecting';
  private view: View | null = null;
  private chat: ChatMessage[] = [];
  private hostPeer: string | null = null;
  private hostPlayerId: string | null = null;
  /** Offers the lobby currently uses, by hash. */
  private offers = new Map<string, PackOfferState>();
  /** Everything custom this page loaded, by hash. Kept when the lobby moves on. */
  private loaded = new Map<string, Imported>();

  constructor(opts: ClientOptions) {
    this.code = opts.code;
    this.me = opts.me;
    this.playerId = opts.me.playerId;
    this.transport = opts.transport;
    this.loader = opts.packs;
    const t = opts.transport;
    this.out = {
      hello: t.channel<Hello>(ACTION.hello),
      say: t.channel<string>(ACTION.say),
      intent: t.channel<Intent>(ACTION.intent),
      packReply: t.channel<PackReply>(ACTION.packReply),
    };
    const fromHost = (from: string) => this.hostPeer === null || from === this.hostPeer;

    const view = t.channel<View>(ACTION.view);
    view.guard((bytes) => bytes <= MAX_BYTES.view);
    view.onMessage((v, from) => this.onView(v, from));

    const chat = t.channel<ChatPayload>(ACTION.chat);
    chat.guard((bytes, from) => bytes <= MAX_BYTES.chat && fromHost(from));
    chat.onMessage((payload, from) => this.onChat(payload, from));

    const offer = t.channel<unknown>(ACTION.packOffer);
    offer.guard((bytes, from) => bytes <= MAX_BYTES.packOffer && from === this.hostPeer);
    offer.onMessage((data, from) => void this.onPackOffer(data, from));

    // Only the file this page asked for, from the host, no bigger than offered.
    const data = t.channel<Uint8Array>(ACTION.packData);
    data.guard((bytes, from) => {
      const current = this.downloading();
      return from === this.hostPeer && current !== undefined && bytes <= Math.min(MAX_PACK_BYTES, current.offer.bytes);
    });
    data.onProgress((fraction, from) => this.onProgress(fraction, from));
    data.onMessage((bytes, from) => void this.onPackData(bytes, from));

    t.onPeerJoin((peerId) => this.sayHello(peerId));
    t.onPeerLeave((peerId) => {
      if (peerId !== this.hostPeer) return;
      this.hostPeer = null;
      if (this.status === 'connected') this.setStatus('hostAway');
    });
  }

  state(): SessionState {
    const lobby = this.view?.lobby;
    const game = lobby?.customPack ? this.loaded.get(lobby.customPack.hash) : undefined;
    const addons = (lobby?.customAddons ?? []).flatMap((o): LoadedAddon[] => {
      const item = this.loaded.get(o.hash);
      return item?.kind === 'addon' ? [item.addon] : [];
    });
    return {
      status: this.status,
      view: this.view,
      chat: this.chat,
      customPack: game?.kind === 'game' ? game.pack : null,
      customAddons: addons,
      packOffers: [...this.offers.values()],
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  say(text: string): void {
    if (this.hostPeer) void this.out.say.send(text, this.hostPeer);
  }

  act(intent: Intent): void {
    if (this.hostPeer) void this.out.intent.send(intent, this.hostPeer);
  }

  /** One answer for everything still open: download it all, one file at a time, or watch. */
  answerPackOffer(accept: boolean): void {
    let changed = false;
    for (const [hash, state] of this.offers) {
      if (!['asking', 'declined', 'failed', ...(accept ? [] : ['queued'])].includes(state.status)) continue;
      this.offers.set(hash, { offer: state.offer, status: accept ? 'queued' : 'declined', progress: 0 });
      if (!accept) this.reply({ hash, accept: false });
      changed = true;
    }
    if (!changed) return;
    this.pump();
    this.notify();
  }

  availablePacks(): LoadedPack[] {
    return [];
  }

  leave(): void {
    this.transport.leave();
    this.listeners.clear();
  }

  private sayHello(peerId: string): void {
    const { playerId, name, color } = this.me;
    void this.out.hello.send({ protocol: PROTOCOL_VERSION, playerId, name, color, cachedPacks: [] }, peerId);
  }

  private reply(reply: PackReply): void {
    if (this.hostPeer) void this.out.packReply.send(reply, this.hostPeer);
  }

  private downloading(): PackOfferState | undefined {
    return [...this.offers.values()].find((o) => o.status === 'downloading');
  }

  /** Starts the next queued download, unless one is running or being checked. */
  private pump(): void {
    const states = [...this.offers.values()];
    if (states.some((o) => o.status === 'downloading' || o.status === 'loading')) return;
    const next = states.find((o) => o.status === 'queued');
    if (!next) return;
    this.offers.set(next.offer.hash, { offer: next.offer, status: 'downloading', progress: 0 });
    this.reply({ hash: next.offer.hash, accept: true, cached: false });
  }

  private onView(view: View, from: string): void {
    if (!view || typeof view !== 'object' || typeof view.seq !== 'number' || typeof view.hostPlayerId !== 'string') return;
    if (view.lobby?.code !== this.code) return;
    if (this.hostPlayerId === null) {
      this.hostPlayerId = view.hostPlayerId;
    } else if (view.hostPlayerId !== this.hostPlayerId) {
      return;
    }
    if (from === this.hostPeer) {
      if (this.view && view.seq <= this.view.seq) return;
    } else {
      // The host came back with a new connection. Its seq may have restarted, so take this view
      // as the new baseline.
      this.hostPeer = from;
    }
    this.view = view;
    this.status = view.outdated ? 'outdated' : 'connected';
    // Forget offers the lobby no longer uses. Loaded files stay for later.
    const used = new Set([view.lobby.customPack?.hash, ...(view.lobby.customAddons ?? []).map((o) => o.hash)]);
    for (const [hash, state] of this.offers) if (!used.has(hash) && state.status !== 'loading') this.offers.delete(hash);
    this.notify();
  }

  private onChat(payload: ChatPayload, from: string): void {
    if (from !== this.hostPeer || !payload || !Array.isArray(payload.messages)) return;
    const incoming = payload.messages.filter(isChatMessage);
    if (payload.history) {
      this.chat = incoming.slice(-CHAT_HISTORY);
    } else {
      const known = new Set(this.chat.map((m) => m.id));
      this.chat = [...this.chat, ...incoming.filter((m) => !known.has(m.id))].slice(-CHAT_HISTORY);
    }
    this.notify();
  }

  private async onPackOffer(data: unknown, from: string): Promise<void> {
    const offer = parseOffer(data);
    if (!offer || from !== this.hostPeer) return;
    const hash = offer.hash;
    const current = this.offers.get(hash);
    if (this.loaded.has(hash)) {
      this.offers.set(hash, { offer, status: 'ready', progress: 1 });
      this.reply({ hash, accept: true, cached: true });
      this.notify();
      return;
    }
    // Already on it (the host offered again after a reconnect).
    if (current && ['checking', 'queued', 'downloading', 'loading'].includes(current.status)) {
      if (current.status === 'downloading') this.reply({ hash, accept: true, cached: false });
      return;
    }
    this.offers.set(hash, { offer, status: 'checking', progress: 0 });
    this.notify();
    const cached = (await this.loader?.cached(hash)) ?? null;
    if (this.offers.get(hash)?.status !== 'checking') return;
    if (cached) {
      this.loaded.set(hash, cached);
      this.offers.set(hash, { offer, status: 'ready', progress: 1 });
      this.reply({ hash, accept: true, cached: true });
    } else {
      // Said yes to this lobby's other files already: this one comes along.
      const agreed = [...this.offers.values()].some((o) => o.offer.hash !== hash && ['queued', 'downloading', 'loading'].includes(o.status));
      this.offers.set(hash, { offer, status: agreed ? 'queued' : 'asking', progress: 0 });
      this.pump();
    }
    this.notify();
  }

  private onProgress(fraction: number, from: string): void {
    const offer = this.downloading();
    if (from !== this.hostPeer || !offer) return;
    // Redraw at most once per percent.
    if (Math.floor(fraction * 100) === Math.floor(offer.progress * 100)) return;
    this.offers.set(offer.offer.hash, { ...offer, progress: Math.min(1, Math.max(0, fraction)) });
    this.notify();
  }

  private async onPackData(raw: Uint8Array, from: string): Promise<void> {
    const offer = this.downloading();
    if (from !== this.hostPeer || !offer) return;
    const hash = offer.offer.hash;
    this.offers.set(hash, { offer: offer.offer, status: 'loading', progress: 1 });
    this.notify();
    try {
      if (!this.loader) throw new PackImportError(['This page cannot load custom packs.']);
      // A fresh copy: the payload may be a view into a larger buffer.
      const bytes = new Uint8Array(raw);
      const item = await this.loader.load(bytes, hash);
      if (item.kind !== offer.offer.kind) throw new PackImportError([`Expected ${offer.offer.kind === 'game' ? 'a game' : 'an addon'}.`]);
      this.loaded.set(hash, item);
      if (this.offers.has(hash)) this.offers.set(hash, { offer: offer.offer, status: 'ready', progress: 1 });
      this.reply({ hash, accept: true, cached: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.offers.has(hash)) this.offers.set(hash, { offer: offer.offer, status: 'failed', progress: 0, error: message });
      this.reply({ hash, accept: false, error: message.slice(0, 300) });
    }
    this.pump();
    this.notify();
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function isChatMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false;
  const c = m as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.from === 'string' &&
    typeof c.name === 'string' &&
    typeof c.text === 'string' &&
    typeof c.at === 'number'
  );
}

function parseOffer(data: unknown): PackOffer | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
  if (typeof o.hash !== 'string' || !/^[0-9a-f]{64}$/.test(o.hash) || !text(o.name)) return null;
  if (!Number.isInteger(o.bytes) || (o.bytes as number) <= 0 || (o.bytes as number) > MAX_PACK_BYTES) return null;
  if (!Number.isInteger(o.images) || (o.images as number) < 0) return null;
  if (o.kind !== 'game' && o.kind !== 'addon') return null;
  if (o.kind === 'addon' && !text(o.extends)) return null;
  return {
    hash: o.hash,
    kind: o.kind,
    ...(o.kind === 'addon' ? { extends: o.extends as string } : {}),
    name: o.name as string,
    ...(text(o.author) ? { author: o.author as string } : {}),
    bytes: o.bytes as number,
    images: o.images as number,
  };
}

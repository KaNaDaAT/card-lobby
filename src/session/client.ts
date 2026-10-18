/**
 * A joining player's side of a room. It says hello to every peer, locks onto the first peer
 * that answers with a view, keeps the newest view by `seq`, and sends intents to the host.
 * Clients never run game rules. See docs/DESIGN.md, "Identity, host lock and reconnects".
 *
 * Custom packs: the host offers one, the client loads it from its cache or asks the player,
 * downloads it, checks its hash and contents, and tells the host it is ready. See
 * docs/DESIGN.md, "Custom packs".
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
import { MAX_PACK_BYTES, PackImportError } from '../packs/custom';
import type { PackLoader } from '../packs/loader';
import type { LoadedPack, PackOffer } from '../packs/types';
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
  private offer: PackOfferState | null = null;
  private customPack: LoadedPack | null = null;

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

    // Only the pack this page asked for, from the host, no bigger than offered.
    const data = t.channel<Uint8Array>(ACTION.packData);
    data.guard(
      (bytes, from) =>
        from === this.hostPeer && this.offer?.status === 'downloading' && bytes <= Math.min(MAX_PACK_BYTES, this.offer.offer.bytes),
    );
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
    return { status: this.status, view: this.view, chat: this.chat, customPack: this.customPack, packOffer: this.offer };
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

  answerPackOffer(accept: boolean): void {
    const offer = this.offer;
    if (!offer || !['asking', 'declined', 'failed'].includes(offer.status)) return;
    this.offer = accept ? { offer: offer.offer, status: 'downloading', progress: 0 } : { offer: offer.offer, status: 'declined', progress: 0 };
    this.reply({ hash: offer.offer.hash, accept, cached: false });
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
    // The host moved on to a built-in pack: forget the offer, keep any loaded pack for later.
    if (!view.lobby.customPack && this.offer && this.offer.status !== 'loading') this.offer = null;
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
    const current = this.offer;
    if (this.customPack?.custom?.offer.hash === offer.hash) {
      this.offer = { offer, status: 'ready', progress: 1 };
      this.reply({ hash: offer.hash, accept: true, cached: true });
      this.notify();
      return;
    }
    // Already on it (the host offered again after a reconnect).
    if (current?.offer.hash === offer.hash && ['checking', 'downloading', 'loading'].includes(current.status)) {
      if (current.status === 'downloading') this.reply({ hash: offer.hash, accept: true, cached: false });
      return;
    }
    this.offer = { offer, status: 'checking', progress: 0 };
    this.notify();
    const cached = (await this.loader?.cached(offer.hash)) ?? null;
    if (this.offer?.offer.hash !== offer.hash || this.offer.status !== 'checking') return;
    if (cached) {
      this.customPack = cached;
      this.offer = { offer, status: 'ready', progress: 1 };
      this.reply({ hash: offer.hash, accept: true, cached: true });
    } else {
      this.offer = { offer, status: 'asking', progress: 0 };
    }
    this.notify();
  }

  private onProgress(fraction: number, from: string): void {
    const offer = this.offer;
    if (from !== this.hostPeer || offer?.status !== 'downloading') return;
    // Redraw at most once per percent.
    if (Math.floor(fraction * 100) === Math.floor(offer.progress * 100)) return;
    this.offer = { ...offer, progress: Math.min(1, Math.max(0, fraction)) };
    this.notify();
  }

  private async onPackData(raw: Uint8Array, from: string): Promise<void> {
    const offer = this.offer;
    if (from !== this.hostPeer || offer?.status !== 'downloading') return;
    const hash = offer.offer.hash;
    this.offer = { offer: offer.offer, status: 'loading', progress: 1 };
    this.notify();
    try {
      if (!this.loader) throw new PackImportError(['This page cannot load custom packs.']);
      // A fresh copy: the payload may be a view into a larger buffer.
      const bytes = new Uint8Array(raw);
      const lp = await this.loader.load(bytes, hash);
      if (this.offer?.offer.hash !== hash) return;
      this.customPack = lp;
      this.offer = { offer: offer.offer, status: 'ready', progress: 1 };
      this.reply({ hash, accept: true, cached: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.offer = { offer: offer.offer, status: 'failed', progress: 0, error: message };
      this.reply({ hash, accept: false, error: message.slice(0, 300) });
    }
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
  return {
    hash: o.hash,
    name: o.name as string,
    ...(text(o.author) ? { author: o.author as string } : {}),
    bytes: o.bytes as number,
    images: o.images as number,
  };
}

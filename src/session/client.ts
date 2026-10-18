/**
 * A joining player's side of a room. It says hello to every peer, locks onto the first peer
 * that answers with a view, keeps the newest view by `seq`, and sends intents to the host.
 * Clients never run game rules. See docs/DESIGN.md, "Identity, host lock and reconnects".
 */
import type { Identity } from '../identity';
import {
  ACTION,
  CHAT_HISTORY,
  PROTOCOL_VERSION,
  type ChatMessage,
  type ChatPayload,
  type Hello,
  type Intent,
  type View,
} from '../net/protocol';
import type { Channel, Transport } from '../net/transport';
import type { Session, SessionState, SessionStatus } from './types';

export interface ClientOptions {
  code: string;
  me: Identity;
  transport: Transport;
}

export class ClientSession implements Session {
  readonly isHost = false;
  readonly playerId: string;

  private readonly code: string;
  private readonly me: Identity;
  private readonly transport: Transport;
  private readonly listeners = new Set<() => void>();
  private readonly out: { hello: Channel<Hello>; say: Channel<string>; intent: Channel<Intent> };

  private status: SessionStatus = 'connecting';
  private view: View | null = null;
  private chat: ChatMessage[] = [];
  private hostPeer: string | null = null;
  private hostPlayerId: string | null = null;

  constructor(opts: ClientOptions) {
    this.code = opts.code;
    this.me = opts.me;
    this.playerId = opts.me.playerId;
    this.transport = opts.transport;
    const t = opts.transport;
    this.out = {
      hello: t.channel<Hello>(ACTION.hello),
      say: t.channel<string>(ACTION.say),
      intent: t.channel<Intent>(ACTION.intent),
    };
    t.channel<View>(ACTION.view).onMessage((view, from) => this.onView(view, from));
    t.channel<ChatPayload>(ACTION.chat).onMessage((payload, from) => this.onChat(payload, from));
    t.onPeerJoin((peerId) => this.sayHello(peerId));
    t.onPeerLeave((peerId) => {
      if (peerId !== this.hostPeer) return;
      this.hostPeer = null;
      if (this.status === 'connected') this.setStatus('hostAway');
    });
  }

  state(): SessionState {
    return { status: this.status, view: this.view, chat: this.chat };
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

  leave(): void {
    this.transport.leave();
    this.listeners.clear();
  }

  private sayHello(peerId: string): void {
    const { playerId, name, color } = this.me;
    void this.out.hello.send({ protocol: PROTOCOL_VERSION, playerId, name, color, cachedPacks: [] }, peerId);
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

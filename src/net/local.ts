/**
 * Transport over BroadcastChannel, for several tabs of one browser without any network.
 * Enabled with `?transport=local`.
 *
 * Every tab broadcasts a heartbeat and answers other tabs' heartbeats right away. Hidden tabs
 * have their timers throttled hard, but they still handle messages, so as long as one tab is
 * in front, every tab keeps hearing from every other one. A tab that goes quiet for
 * `LOST_AFTER_MS` counts as gone. Closing a tab says goodbye at once.
 */
import { payloadSize, type Channel, type Transport } from './transport';

const BEAT_MS = 2000;
const LOST_AFTER_MS = 10_000;

type Envelope =
  | { k: 'beat'; from: string; echo?: boolean }
  | { k: 'bye'; from: string }
  | { k: 'msg'; from: string; ch: string; to?: string[]; data: unknown };

export function joinLocalRoom(code: string): Transport {
  const selfId = crypto.randomUUID().slice(0, 8);
  const bc = new BroadcastChannel(`card-lobby:${code}`);
  const lastSeen = new Map<string, number>();
  const joins: ((peerId: string) => void)[] = [];
  const leaves: ((peerId: string) => void)[] = [];
  const channels = new Map<
    string,
    { listeners: ((data: unknown, from: string) => void)[]; guards: ((bytes: number, from: string) => boolean)[] }
  >();
  let left = false;

  const post = (env: Envelope) => {
    if (!left) bc.postMessage(env);
  };

  const seen = (peerId: string) => {
    const known = lastSeen.has(peerId);
    lastSeen.set(peerId, Date.now());
    if (!known) for (const cb of joins) cb(peerId);
  };

  const lost = (peerId: string) => {
    if (!lastSeen.delete(peerId)) return;
    for (const cb of leaves) cb(peerId);
  };

  bc.onmessage = (e: MessageEvent<Envelope>) => {
    const env = e.data;
    if (left || !env || typeof env.from !== 'string' || env.from === selfId) return;
    switch (env.k) {
      case 'beat':
        seen(env.from);
        if (!env.echo) post({ k: 'beat', from: selfId, echo: true });
        break;
      case 'bye':
        lost(env.from);
        break;
      case 'msg': {
        if (env.to && !env.to.includes(selfId)) return;
        seen(env.from);
        const ch = channels.get(env.ch);
        if (!ch || !ch.guards.every((g) => g(payloadSize(env.data), env.from))) return;
        for (const cb of ch.listeners) cb(env.data, env.from);
        break;
      }
    }
  };

  const timer = setInterval(() => {
    post({ k: 'beat', from: selfId });
    const cutoff = Date.now() - LOST_AFTER_MS;
    for (const [peerId, at] of lastSeen) if (at < cutoff) lost(peerId);
  }, BEAT_MS);

  const onHide = () => post({ k: 'bye', from: selfId });
  globalThis.addEventListener?.('pagehide', onHide);

  // Announce after the caller had a chance to register listeners.
  queueMicrotask(() => post({ k: 'beat', from: selfId }));

  return {
    selfId,
    onPeerJoin: (cb) => void joins.push(cb),
    onPeerLeave: (cb) => void leaves.push(cb),
    channel<T>(name: string): Channel<T> {
      const ch = channels.get(name) ?? { listeners: [], guards: [] };
      channels.set(name, ch);
      return {
        send(data: T, to?: string | string[]) {
          post({ k: 'msg', from: selfId, ch: name, to: to === undefined ? undefined : [to].flat(), data });
          return Promise.resolve();
        },
        onMessage(cb) {
          ch.listeners.push(cb as (data: unknown, from: string) => void);
        },
        onProgress() {
          // BroadcastChannel delivers at once.
        },
        guard(check) {
          ch.guards.push(check);
        },
      };
    },
    leave() {
      if (left) return;
      post({ k: 'bye', from: selfId });
      left = true;
      clearInterval(timer);
      globalThis.removeEventListener?.('pagehide', onHide);
      bc.close();
    },
  };
}

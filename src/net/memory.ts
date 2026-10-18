/**
 * In-memory network for tests. Nothing is delivered until `flush()` runs, so tests decide
 * exactly when messages arrive. Payloads are cloned on send, like a real wire would, and
 * guards see their size.
 */
import { payloadSize, type Channel, type Transport } from './transport';

type Listener = (data: unknown, from: string) => void;

interface Peer {
  id: string;
  joins: ((peerId: string) => void)[];
  leaves: ((peerId: string) => void)[];
  channels: Map<string, { listeners: Listener[]; guards: ((bytes: number, from: string) => boolean)[] }>;
  gone: boolean;
}

export interface MemoryNetwork {
  join(id?: string): Transport;
  /** Delivers queued messages and peer events until nothing is left. */
  flush(): void;
  /** Drops a peer without a clean leave, like a closed laptop lid. */
  drop(id: string): void;
}

export function createMemoryNetwork(): MemoryNetwork {
  const peers = new Map<string, Peer>();
  const queue: (() => void)[] = [];
  let counter = 0;

  const notifyLeave = (peer: Peer) => {
    peer.gone = true;
    peers.delete(peer.id);
    for (const other of peers.values()) {
      queue.push(() => {
        if (!other.gone) for (const cb of other.leaves) cb(peer.id);
      });
    }
  };

  return {
    join(id = `peer${++counter}`) {
      if (peers.has(id)) throw new Error(`peer ${id} already joined`);
      const self: Peer = { id, joins: [], leaves: [], channels: new Map(), gone: false };
      for (const other of peers.values()) {
        queue.push(() => {
          if (self.gone || other.gone) return;
          for (const cb of other.joins) cb(self.id);
          for (const cb of self.joins) cb(other.id);
        });
      }
      peers.set(id, self);

      const transport: Transport = {
        selfId: id,
        onPeerJoin: (cb) => void self.joins.push(cb),
        onPeerLeave: (cb) => void self.leaves.push(cb),
        channel<T>(name: string): Channel<T> {
          const ch = self.channels.get(name) ?? { listeners: [], guards: [] };
          self.channels.set(name, ch);
          return {
            send(data: T, to?: string | string[]) {
              if (self.gone) return Promise.resolve();
              const targets = to === undefined ? [...peers.keys()] : Array.isArray(to) ? to : [to];
              const size = payloadSize(data);
              for (const target of targets) {
                if (target === self.id) continue;
                const copy = structuredClone(data);
                queue.push(() => {
                  const peer = peers.get(target);
                  const theirs = peer?.channels.get(name);
                  if (!peer || !theirs || peer.gone || self.gone) return;
                  if (!theirs.guards.every((g) => g(size, self.id))) return;
                  for (const cb of theirs.listeners) cb(copy, self.id);
                });
              }
              return Promise.resolve();
            },
            onMessage(cb) {
              ch.listeners.push(cb as Listener);
            },
            onProgress() {
              // Delivered at once.
            },
            guard(check) {
              ch.guards.push(check);
            },
          };
        },
        leave() {
          if (!self.gone) notifyLeave(self);
        },
      };
      return transport;
    },

    flush() {
      for (let i = 0; queue.length; i++) {
        if (i > 100_000) throw new Error('memory network did not settle');
        queue.shift()!();
      }
    },

    drop(id) {
      const peer = peers.get(id);
      if (peer) notifyLeave(peer);
    },
  };
}

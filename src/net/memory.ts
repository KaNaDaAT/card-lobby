/**
 * In-memory network for tests. Nothing is delivered until `flush()` runs, so tests decide
 * exactly when messages arrive. Payloads are cloned on send, like a real wire would.
 */
import type { Channel, Transport } from './transport';

type Listener = (data: unknown, from: string) => void;

interface Peer {
  id: string;
  joins: ((peerId: string) => void)[];
  leaves: ((peerId: string) => void)[];
  channels: Map<string, Listener[]>;
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
          const listeners = self.channels.get(name) ?? [];
          self.channels.set(name, listeners);
          return {
            send(data: T, to?: string | string[]) {
              if (self.gone) return Promise.resolve();
              const targets = to === undefined ? [...peers.keys()] : Array.isArray(to) ? to : [to];
              const wire = JSON.stringify(data);
              for (const target of targets) {
                if (target === self.id) continue;
                queue.push(() => {
                  const peer = peers.get(target);
                  if (!peer || peer.gone || self.gone) return;
                  for (const cb of peer.channels.get(name) ?? []) cb(JSON.parse(wire), self.id);
                });
              }
              return Promise.resolve();
            },
            onMessage(cb) {
              listeners.push(cb as Listener);
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

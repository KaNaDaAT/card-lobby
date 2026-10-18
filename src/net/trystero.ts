/**
 * Transport over Trystero (WebRTC, Nostr signaling). The join code is both the room id and the
 * password, so relays only ever see encrypted signaling. See docs/DESIGN.md, "Rooms, codes and
 * encryption".
 */
import { joinRoom, selfId, type DataPayload, type MessageAction } from 'trystero';
import type { Channel, Transport } from './transport';

export const APP_ID = 'card-lobby';

/** Room-wide receive budget. Custom packs are at most 25 MB (milestone 5). */
const MAX_RECEIVE_BYTES = 30 * 1024 * 1024;

export function joinTrysteroRoom(code: string): Transport {
  const room = joinRoom({ appId: APP_ID, password: code, maxReceiveBytes: MAX_RECEIVE_BYTES }, code);
  const joins: ((peerId: string) => void)[] = [];
  const leaves: ((peerId: string) => void)[] = [];
  const channels = new Map<string, Channel<unknown>>();

  room.onPeerJoin = (peerId) => joins.forEach((cb) => cb(peerId));
  room.onPeerLeave = (peerId) => leaves.forEach((cb) => cb(peerId));

  return {
    selfId,
    onPeerJoin: (cb) => void joins.push(cb),
    onPeerLeave: (cb) => void leaves.push(cb),
    channel<T>(name: string): Channel<T> {
      const existing = channels.get(name);
      if (existing) return existing as Channel<T>;
      const action: MessageAction = room.makeAction(name);
      const listeners: ((data: T, from: string) => void)[] = [];
      action.onMessage = (data, { peerId }) => listeners.forEach((cb) => cb(data as T, peerId));
      const channel: Channel<T> = {
        // Our payloads are plain JSON objects. Trystero's JsonValue type wants index signatures.
        send: (data, to) => action.send(data as DataPayload, { target: to ?? null }),
        onMessage: (cb) => void listeners.push(cb),
      };
      channels.set(name, channel as Channel<unknown>);
      return channel;
    },
    leave() {
      void room.leave();
    },
  };
}

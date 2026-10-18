/**
 * Transport over Trystero (WebRTC, Nostr signaling). The join code is both the room id and the
 * password, so relays only ever see encrypted signaling. See docs/DESIGN.md, "Rooms, codes and
 * encryption".
 */
import { joinRoom, selfId, type DataPayload, type MessageAction, type NostrRoomConfig } from 'trystero';
import type { Channel, Transport } from './transport';

export const APP_ID = 'card-lobby';

/** Room-wide receive budget. Custom packs are at most 25 MB. */
const MAX_RECEIVE_BYTES = 30 * 1024 * 1024;

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Room settings, with TURN servers and relays from the build settings (see `.env.example`). */
export function roomConfig(code: string, env: ImportMetaEnv = import.meta.env): NostrRoomConfig {
  const config: NostrRoomConfig = { appId: APP_ID, password: code, maxReceiveBytes: MAX_RECEIVE_BYTES };
  const turn = list(env.VITE_TURN_URLS);
  if (turn.length) {
    config.turnConfig = [
      {
        urls: turn,
        ...(env.VITE_TURN_USERNAME ? { username: env.VITE_TURN_USERNAME } : {}),
        ...(env.VITE_TURN_CREDENTIAL ? { credential: env.VITE_TURN_CREDENTIAL } : {}),
      },
    ];
  }
  const relays = list(env.VITE_NOSTR_RELAYS);
  if (relays.length) config.relayConfig = { urls: relays };
  return config;
}

export function joinTrysteroRoom(code: string): Transport {
  const room = joinRoom(roomConfig(code), code);
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
      const progress: ((fraction: number, from: string) => void)[] = [];
      const guards: ((bytes: number, from: string) => boolean)[] = [];
      action.onMessage = (data, { peerId }) => {
        const payload = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        listeners.forEach((cb) => cb(payload as T, peerId));
      };
      // Runs before a payload is received, so oversized ones are declined without the download.
      action.onReceive = ({ byteLength, peerId }) => guards.every((g) => g(byteLength, peerId));
      action.onReceiveProgress = (fraction, { peerId }) => progress.forEach((cb) => cb(fraction, peerId));
      const channel: Channel<T> = {
        // Our payloads are plain JSON objects. Trystero's JsonValue type wants index signatures.
        send: (data, to) => action.send(data as DataPayload, { target: to ?? null }),
        onMessage: (cb) => void listeners.push(cb),
        onProgress: (cb) => void progress.push(cb),
        guard: (check) => void guards.push(check),
      };
      channels.set(name, channel as Channel<unknown>);
      return channel;
    },
    leave() {
      void room.leave();
    },
  };
}

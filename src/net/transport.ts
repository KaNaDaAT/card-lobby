/**
 * What the session layer needs from the network. Implemented over Trystero for real play and
 * over BroadcastChannel for local multi-tab development (milestone 1).
 */
export interface Transport {
  readonly selfId: string;
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  channel<T>(name: string): Channel<T>;
  leave(): void;
}

export interface Channel<T> {
  /** Sends to one peer, several, or everyone when `to` is omitted. Binary data goes as Uint8Array. */
  send(data: T, to?: string | string[]): Promise<void>;
  onMessage(cb: (data: T, from: string) => void): void;
  /** Progress of a large payload arriving, from 0 to 1. Transports that deliver at once never call it. */
  onProgress(cb: (fraction: number, from: string) => void): void;
  /**
   * Decides from its size and sender whether to take a payload, before it arrives in full where
   * the transport allows. Every guard must agree. Untrusted peers can send anything, so every
   * channel should have one.
   */
  guard(check: (bytes: number, from: string) => boolean): void;
}

/** Size of a payload as it travels: bytes for binary data, JSON length otherwise. */
export function payloadSize(data: unknown): number {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

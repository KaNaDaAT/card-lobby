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
  /** Sends to one peer, several, or everyone when `to` is omitted. */
  send(data: T, to?: string | string[]): Promise<void>;
  onMessage(cb: (data: T, from: string) => void): void;
}

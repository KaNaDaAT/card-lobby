import type { ChatMessage, Intent, View } from '../net/protocol';

/**
 * `connecting`: no view from a host yet. `hostAway`: the host's connection dropped, the last
 * view stays on screen. `outdated`: the host speaks a newer protocol.
 */
export type SessionStatus = 'connecting' | 'connected' | 'hostAway' | 'outdated';

export interface SessionState {
  status: SessionStatus;
  view: View | null;
  chat: ChatMessage[];
}

/** What the screens use. The host and the clients both implement it. */
export interface Session {
  readonly isHost: boolean;
  readonly playerId: string;
  state(): SessionState;
  /** Calls `cb` after every change. Returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
  say(text: string): void;
  act(intent: Intent): void;
  leave(): void;
}

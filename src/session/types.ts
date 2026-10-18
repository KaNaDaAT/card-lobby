import type { ChatMessage, Intent, View } from '../net/protocol';
import type { LoadedPack, PackOffer } from '../packs/types';

/**
 * `connecting`: no view from a host yet. `hostAway`: the host's connection dropped, the last
 * view stays on screen. `outdated`: the host speaks a newer protocol.
 */
export type SessionStatus = 'connecting' | 'connected' | 'hostAway' | 'outdated';

export interface SessionState {
  status: SessionStatus;
  view: View | null;
  chat: ChatMessage[];
  /** The custom pack the lobby uses, once this page has it loaded. */
  customPack: LoadedPack | null;
  /** A custom pack the host offers, and where this page stands with it. Clients only. */
  packOffer: PackOfferState | null;
}

export interface PackOfferState {
  offer: PackOffer;
  /** `checking` looks in the cache, `asking` waits for consent, `loading` checks the download. */
  status: 'checking' | 'asking' | 'downloading' | 'loading' | 'ready' | 'declined' | 'failed';
  /** Download progress from 0 to 1. */
  progress: number;
  error?: string;
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
  /** Accepts or declines the custom pack the host offers. Clients only. */
  answerPackOffer(accept: boolean): void;
  /** Games this page can pick from. The host's built-in and uploaded packs; empty for clients. */
  availablePacks(): LoadedPack[];
  leave(): void;
}

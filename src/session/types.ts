import type { ChatMessage, Intent, View } from '../net/protocol';
import type { LoadedAddon, LoadedPack, PackOffer } from '../packs/types';

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
  /** Addons from their own zips that this page has loaded. */
  customAddons: LoadedAddon[];
  /** Custom files the host offers, and where this page stands with each. Clients only. */
  packOffers: PackOfferState[];
}

export interface PackOfferState {
  offer: PackOffer;
  /**
   * `checking` looks in the cache, `asking` waits for consent, `queued` waits for another
   * download to finish, `loading` checks the download.
   */
  status: 'checking' | 'asking' | 'queued' | 'downloading' | 'loading' | 'ready' | 'declined' | 'failed';
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
  /** Accepts or declines everything custom the host offers. Clients only. */
  answerPackOffer(accept: boolean): void;
  /**
   * Games this page can pick from: the host's built-in and uploaded games, each with the addons
   * uploaded for it. Empty for clients.
   */
  availablePacks(): LoadedPack[];
  leave(): void;
}

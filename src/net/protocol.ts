/** Messages between host and clients. See docs/DESIGN.md, "Protocol". */
import type { GameView } from '../engine/types';
import type { OptionValue, PackOffer } from '../packs/types';

export type { PackOffer } from '../packs/types';

export const PROTOCOL_VERSION = 2;

/** Trystero action names. Kept short, Trystero limits their length. */
export const ACTION = {
  hello: 'hello',
  view: 'view',
  say: 'say',
  chat: 'chat',
  intent: 'intent',
  packOffer: 'packOffer',
  packReply: 'packReply',
  packData: 'packData',
} as const;

export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY = 500;

/** Largest payload each action may carry, in bytes. Anything bigger is dropped unread. */
export const MAX_BYTES = {
  hello: 8 * 1024,
  say: 8 * 1024,
  intent: 8 * 1024,
  packReply: 4 * 1024,
  packOffer: 4 * 1024,
  view: 2 * 1024 * 1024,
  chat: 1024 * 1024,
} as const;

export interface Hello {
  protocol: number;
  playerId: string;
  name: string;
  color: string;
  /** Hashes of custom packs this client already has cached. */
  cachedPacks: string[];
}

export interface LobbyPlayer {
  playerId: string;
  name: string;
  color: string;
  connected: boolean;
  isHost: boolean;
  role: 'player' | 'spectator';
  /** Where the player stands with the lobby's pack. Built-in packs are always ready. */
  pack: PackStatus;
}

/** `failed` means the pack arrived but did not check out on the player's side. */
export type PackStatus = 'ready' | 'offered' | 'downloading' | 'declined' | 'failed';

export interface LobbyView {
  code: string;
  hostPlayerId: string;
  phase: 'lobby' | 'playing';
  players: LobbyPlayer[];
  packId: string | null;
  addons: string[];
  options: Record<string, OptionValue>;
  customPack: PackOffer | null;
  /** Why Start is disabled, or null when the host can start. */
  startBlocked: string | null;
}

export interface View {
  seq: number;
  hostPlayerId: string;
  lobby: LobbyView;
  game: GameView | null;
  /** Set when the client speaks an older protocol. The page shows only this. */
  outdated?: boolean;
}

export interface ChatMessage {
  id: string;
  /** playerId, or "system" for join and leave notices. */
  from: string;
  name: string;
  text: string;
  at: number;
}

/** Payload of the `chat` action. `history` replaces what the client has (sent on join). */
export interface ChatPayload {
  messages: ChatMessage[];
  history?: boolean;
}

export type Intent =
  | { kind: 'selectPack'; packId: string }
  | { kind: 'toggleAddon'; addonId: string; on: boolean }
  | { kind: 'setOption'; id: string; value: OptionValue }
  | { kind: 'start' }
  | { kind: 'answer'; promptId: string; value: unknown }
  | { kind: 'react'; uid: string }
  | { kind: 'nextRound' }
  | { kind: 'rematch' }
  | { kind: 'endGame' }
  | { kind: 'kickForRound'; playerId: string }
  | { kind: 'removePlayer'; playerId: string }
  | { kind: 'assignSeat'; seatOf: string; to: string };

/**
 * A player's answer to a pack offer. `cached` means they have the pack loaded, from their cache
 * or after the download. Accepting without `cached` asks the host to send it.
 */
export interface PackReply {
  hash: string;
  accept: boolean;
  cached?: boolean;
  /** Why a downloaded pack was refused. */
  error?: string;
}

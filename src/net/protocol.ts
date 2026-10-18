/** Messages between host and clients. See docs/DESIGN.md, "Protocol". */
import type { GameView } from '../engine/types';
import type { OptionValue } from '../packs/types';

export const PROTOCOL_VERSION = 1;

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
  /** False while a custom pack is not downloaded or was declined. */
  packReady: boolean;
}

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

export type Intent =
  | { kind: 'selectPack'; packId: string }
  | { kind: 'toggleAddon'; addonId: string; on: boolean }
  | { kind: 'setOption'; id: string; value: OptionValue }
  | { kind: 'start' }
  | { kind: 'answer'; promptId: string; value: unknown }
  | { kind: 'kickForRound'; playerId: string }
  | { kind: 'removePlayer'; playerId: string }
  | { kind: 'assignSeat'; seatOf: string; to: string };

export interface PackOffer {
  hash: string;
  name: string;
  author?: string;
  bytes: number;
  images: number;
}

export interface PackReply {
  hash: string;
  accept: boolean;
}

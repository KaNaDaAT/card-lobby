/**
 * Test helpers: a scripted table for Power Hungry Pets. `rig` sets the cards in a zone by
 * swapping card identities with other instances, so card counts and open prompts stay valid.
 */
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import bigLitterJson from '../../public/packs/power-hungry-pets/addons/big-litter.json';
import kittensJson from '../../public/packs/exploding-kittens/pack.json';
import { mergeAddons } from '../packs/merge';
import type { Addon, OptionValue, Pack } from '../packs/types';
import { apply, startGame, viewFor } from './index';
import type { GameState, GameView, Input, Seat } from './types';

export const petsBase = petsJson as unknown as Pack;
export const bigLitter = bigLitterJson as unknown as Addon;
export const kittens = kittensJson as unknown as Pack;

export function petsPack(addons: string[] = []): Pack {
  return mergeAddons(petsBase, [bigLitter], addons);
}

export const PLAYER_NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon'];

export function newGame(pack: Pack, players: number, seed = 1, options: Record<string, OptionValue> = {}): GameState {
  return startGame(pack, {
    packId: pack.id,
    players: PLAYER_NAMES.slice(0, players).map((name, i) => ({ playerId: `p${i}`, name, color: '#4cc9f0' })),
    options,
    seed,
  });
}

export class Table {
  s: GameState;
  /** The host clock passed with inputs, for reaction windows. */
  now = 0;
  private locked = new Set<string>();

  constructor(
    readonly pack: Pack,
    players = 3,
    seed = 1,
    options: Record<string, OptionValue> = {},
  ) {
    this.s = newGame(pack, players, seed, options);
  }

  /** Turn order from the active player: [active, next, next after that, ...]. */
  get order(): Seat[] {
    const n = this.s.players.length;
    const out: Seat[] = [];
    for (let i = 0; i < n; i++) {
      const seat = (this.s.turn.seat + i) % n;
      if (this.s.players[seat]!.round === 'in') out.push(seat);
    }
    return out;
  }

  get prompt() {
    return this.s.prompt;
  }

  input(input: Input): void {
    const result = apply(this.pack, this.s, input);
    if (result.error) throw new Error(result.error);
    this.s = result.state;
  }

  /** Tries an input and returns the refusal, if any. */
  try(input: Input): string | undefined {
    const result = apply(this.pack, this.s, input);
    this.s = result.state;
    return result.error;
  }

  answer(value: unknown): void {
    const p = this.s.prompt;
    if (!p) throw new Error('no open prompt');
    this.input({ kind: 'answer', seat: p.to, promptId: p.id, value, now: this.now });
  }

  /** The active player plays the first card in hand with this id. */
  play(cardId: string): void {
    this.playCards([cardId]);
  }

  /** The active player plays these cards together, picked by id from their hand. */
  playCards(cardIds: string[]): void {
    this.answer(this.uidsFor(cardIds));
  }

  /** The uids a play of these card ids would send, without sending it. */
  uidsFor(cardIds: string[]): string[] {
    const p = this.s.prompt;
    if (p?.kind !== 'play') throw new Error(`expected a play prompt, got ${p?.kind ?? 'none'}`);
    const left = [...p.choices];
    return cardIds.map((cardId) => {
      const i = left.findIndex((u) => this.s.cards[u]!.cardId === cardId);
      if (i < 0) throw new Error(`${cardId} is not in hand (${this.cardIds(`hand:${p.to}`).join(', ')})`);
      return left.splice(i, 1)[0]!;
    });
  }

  /** The active player plays nothing more this turn. */
  pass(): void {
    this.answer([]);
  }

  /** A player reacts to the open window with the first card of this id in their hand. */
  react(seat: Seat, cardId: string): void {
    const uid = this.s.zones[`hand:${seat}`]!.cards.find((u) => this.s.cards[u]!.cardId === cardId);
    if (!uid) throw new Error(`${cardId} is not in ${seat}'s hand`);
    this.input({ kind: 'react', seat, uid, now: this.now });
  }

  /** Lets the open reaction window run out. */
  closeWindow(): void {
    const window = this.s.stack.at(-1);
    if (!window) throw new Error('no reaction window is open');
    this.now = window.endsAt;
    this.input({ kind: 'timeout', now: this.now });
  }

  cardIds(zone: string): string[] {
    return this.s.zones[zone]!.cards.map((uid) => this.s.cards[uid]!.cardId);
  }

  /** Makes `zone` hold these card ids, top first. Other zones lose those copies in exchange. */
  rig(zone: string, cardIds: string[]): void {
    const uids = this.s.zones[zone]!.cards;
    if (cardIds.length > uids.length) throw new Error(`${zone} has only ${uids.length} cards`);
    cardIds.forEach((want, i) => {
      const uid = uids[i]!;
      this.locked.add(uid);
      if (this.s.cards[uid]!.cardId === want) return;
      const other = Object.values(this.s.cards).find((c) => c.cardId === want && !this.locked.has(c.uid));
      if (!other) throw new Error(`no free ${want} to rig into ${zone}`);
      other.cardId = this.s.cards[uid]!.cardId;
      this.s.cards[uid]!.cardId = want;
    });
    // An open play prompt lists which cards may go alone. The identities just changed.
    const p = this.s.prompt;
    if (p?.kind === 'play') {
      p.alone = p.choices.filter((u) => !this.pack.cards.find((c) => c.id === this.s.cards[u]!.cardId)?.comboOnly);
    }
  }

  /** Moves a free copy of `cardId` from the deck into `zone`, face up if the zone is public. */
  place(zone: string, cardId: string): void {
    const deck = this.s.zones.deck!;
    const uid = deck.cards.find((u) => this.s.cards[u]!.cardId === cardId && !this.locked.has(u));
    if (!uid) throw new Error(`no free ${cardId} in the deck`);
    deck.cards.splice(deck.cards.indexOf(uid), 1);
    const target = this.s.zones[zone]!;
    target.cards.push(uid);
    this.s.cards[uid]!.faceUp = target.visibility === 'public';
    this.locked.add(uid);
  }

  /** Moves every card of `from` to the bottom of `to`, to stage empty zones. */
  drain(from: string, to: string): void {
    this.s.zones[to]!.cards.push(...this.s.zones[from]!.cards.splice(0));
  }

  view(seat: Seat | null): GameView {
    return viewFor(this.s, seat);
  }

  log(seat: Seat | null = null): string[] {
    return this.view(seat).log.map((e) => e.text);
  }

  name(seat: Seat): string {
    return this.s.players[seat]!.name;
  }

  /** Card ids a seat's view shows in another player's hand. */
  seenInHand(viewer: Seat | null, owner: Seat): string[] {
    return this.view(viewer).players[owner]!.hand.known.map((k) => k.card.cardId);
  }
}

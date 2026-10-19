/**
 * The game table, drawn from the latest game view, in one of two layouts. Classic: opponents
 * along the top, shared zones in the middle, your cards at the bottom. Round table: everyone
 * seated around an oval in turn order, an arrow at whoever has to act, the draw pile in the
 * middle. Both show a prompt bar when the game asks you something, and round and game results.
 * Clients never run rules, they only draw views and answer prompts.
 */
import { findCombo } from '../../engine/ops/flow';
import { showdownScore } from '../../engine/round';
import type { GameView, PlayerView, Prompt, PromptKind, Seat, VisibleCard, ZoneView } from '../../engine/types';
import type { LobbyView } from '../../net/protocol';
import { cardOrigins, type CardOrigin } from '../../packs/merge';
import { valueText, type CardDef, type LoadedPack, type Pack } from '../../packs/types';
import { mergeSelection } from '../../session/lobby';
import { avatar, pill } from '../components/bits';
import { cardBack, cardFace, showCard, type CardOpts } from '../components/card';
import { confirmDialog } from '../components/dialog';
import { h, type Child } from '../dom';
import { tableEvents, type TableEvent } from '../events';
import { playEvents } from '../sound';
import { resolvePack, type RoomCtx } from './lobby';

/** Kept by the room between redraws. */
export interface TableMemo {
  /** Card uids drawn before, so only new arrivals animate. */
  seen: Set<string>;
  /** The prompt already answered, so a double click cannot answer twice. */
  answered: string | null;
  /** Cards picked for a multi-card play. */
  picked: string[];
  /** The reaction window this page already reacted to, so a double click cannot react twice. */
  reacted: string | null;
  /** Who the round table's arrow pointed at last, so it only flashes when that changes. */
  focus: Seat | null;
  /** The view drawn last, to tell what just happened. Redraws of the same view have no news. */
  view: GameView | null;
  /** What that view brought, when it came (page clock), and whether its log line is new. */
  events: TableEvent[];
  eventsAt: number;
  tickerNew: boolean;
  /** The newest log line drawn, so the ticker only flashes for a new one. */
  ticker: string | null;
}

export const newTableMemo = (): TableMemo => ({
  seen: new Set(),
  answered: null,
  picked: [],
  reacted: null,
  focus: null,
  view: null,
  events: [],
  eventsAt: 0,
  tickerNew: false,
  ticker: null,
});

/** A redraw this soon after a new view keeps its animations, since answering redraws at once. */
const EVENTS_KEEP_MS = 250;

export type TableLayout = 'classic' | 'round';
const LAYOUT_KEY = 'cardlobby.tableLayout';
let layout: TableLayout | null = null;

/** The layout this browser picked last. Classic unless the player switched. */
export function tableLayout(): TableLayout {
  if (!layout) {
    try {
      layout = localStorage.getItem(LAYOUT_KEY) === 'round' ? 'round' : 'classic';
    } catch {
      layout = 'classic';
    }
  }
  return layout;
}

function setTableLayout(t: T, next: TableLayout): void {
  layout = next;
  try {
    localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Private windows may refuse. The choice still holds until the page reloads.
  }
  t.ctx.redraw();
}

interface T {
  ctx: RoomCtx;
  lobby: LobbyView;
  game: GameView;
  lp: LoadedPack;
  pack: Pack;
  defs: Map<string, CardDef>;
  memo: TableMemo;
  prompt: Prompt | null;
  fresh: Set<string>;
  /** Card ids of every card this seat can see, by uid. */
  known: Map<string, string>;
  /** The game or addon each card id comes from. */
  origins: Map<string, CardOrigin>;
  /** What happened since the last view. Pieces animate for it, once. */
  events: TableEvent[];
  /** The newest log line just arrived. */
  tickerNew: boolean;
}

const WAITING_FOR: Record<PromptKind, string> = {
  play: 'to play',
  choosePlayer: 'to choose a player',
  guess: 'to guess a number',
  choosePosition: 'to put a card back',
  confirm: 'to decide',
  chooseCard: 'to pick a card',
  nameCard: 'to name a card',
};

export function tableMain(ctx: RoomCtx, lobby: LobbyView, game: GameView, memo: TableMemo): Child[] {
  const lp = resolvePack(ctx, lobby);
  if (!lp) return [h('section', { class: 'panel waiting' }, h('h2', null, 'Unknown game'), h('p', { class: 'muted' }, 'This page does not have the game the host is running.'))];
  const pack = mergeSelection(lp, lobby.addons, lobby.counts).pack ?? lp.pack;
  if (memo.view !== game) {
    memo.events = tableEvents(memo.view, game);
    memo.eventsAt = Date.now();
    memo.view = game;
    const last = game.phase === 'round' ? game.log.at(-1) : undefined;
    const key = last ? `${game.log.length}:${last.text}` : null;
    memo.tickerNew = memo.ticker !== null && key !== null && key !== memo.ticker;
    memo.ticker = key;
    playEvents(memo.events);
  }
  const recent = Date.now() - memo.eventsAt < EVENTS_KEEP_MS;
  const t: T = {
    ctx,
    lobby,
    game,
    lp,
    pack,
    defs: new Map(pack.cards.map((c) => [c.id, c])),
    memo,
    prompt: game.prompt && game.prompt.id !== memo.answered ? game.prompt : null,
    fresh: new Set(),
    known: knownCards(game),
    origins: cardOrigins(lp.pack, lp.addons, lobby.addons),
    events: recent ? memo.events : [],
    tickerNew: recent && memo.tickerNew,
  };
  if (game.prompt?.id !== memo.answered) memo.picked = memo.picked.filter((uid) => game.hand.some((c) => c.uid === uid));

  const watching = h('p', { class: 'muted small spectating' }, 'You are watching this game.');
  const content =
    tableLayout() === 'round'
      ? h('section', { class: 'panel table table-round' }, roundTop(t), result(t), roundFelt(t), roundDock(t, watching), splash(t))
      : h(
          'section',
          { class: 'panel table' },
          statusBar(t),
          windowBanner(t),
          result(t),
          h('div', { class: 'seats' }, opponentOrder(t).map((p) => seat(t, p))),
          center(t),
          promptBar(t),
          game.you !== null ? yourArea(t, game.players[game.you]!) : watching,
          splash(t),
        );
  for (const uid of t.fresh) memo.seen.add(uid);
  return [content];
}

/** A big "Your turn" over the table when your turn starts. It fades by itself. */
function splash(t: T): HTMLElement | null {
  if (!t.events.some((e) => e.kind === 'yourTurn')) return null;
  return h('div', { class: 'splash', 'aria-hidden': 'true' }, h('span', null, 'Your turn'));
}

/** Classes that make a seat flash for what just happened to it. */
function seatFlash(t: T, seat: Seat): string {
  if (t.events.some((e) => e.kind === 'out' && e.seat === seat)) return ' is-knocked';
  if (t.events.some((e) => e.kind === 'played' && e.seat === seat)) return ' is-acting';
  return '';
}

// ---------- Pieces ----------

function knownCards(game: GameView): Map<string, string> {
  const map = new Map<string, string>();
  const add = (c: VisibleCard) => map.set(c.uid, c.cardId);
  game.hand.forEach(add);
  for (const p of game.players) {
    p.played.forEach(add);
    p.hand.known.forEach((k) => add(k.card));
  }
  for (const zone of Object.values(game.zones)) zone.known.forEach((k) => add(k.card));
  game.window?.cards.forEach(add);
  return map;
}

function def(t: T, cardId: string): CardDef {
  return t.defs.get(cardId) ?? { id: cardId, name: cardId, count: 0, text: '' };
}

/** A card face, animated the first time this uid is drawn. */
function face(t: T, card: VisibleCard, opts: CardOpts = {}): HTMLElement {
  const enter = !t.memo.seen.has(card.uid);
  t.fresh.add(card.uid);
  return cardFace(t.lp, def(t, card.cardId), { ...opts, enter, origin: t.origins.get(card.cardId) });
}

function back(t: T, key: string, opts: CardOpts = {}): HTMLElement {
  const enter = !t.memo.seen.has(key);
  t.fresh.add(key);
  return cardBack(t.lp, { ...opts, enter });
}

function name(t: T, seat: Seat): string {
  return t.game.players[seat]?.name ?? '?';
}

/** How long an answer may go unanswered before the prompt comes back for another try. */
const RETRY_MS = 4000;

function answer(t: T, value: unknown): void {
  const p = t.game.prompt;
  if (!p || t.memo.answered === p.id) return;
  t.memo.answered = p.id;
  t.memo.picked = [];
  t.ctx.session.act({ kind: 'answer', promptId: p.id, value });
  t.ctx.redraw();
  // If the answer got lost (the host dropped, say), show the question again.
  setTimeout(() => {
    if (t.memo.answered !== p.id) return;
    t.memo.answered = null;
    t.ctx.redraw();
  }, RETRY_MS);
}

function opponentOrder(t: T): PlayerView[] {
  const players = t.game.players;
  const you = t.game.you;
  if (you === null) return players;
  return [...players.slice(you + 1), ...players.slice(0, you)];
}

function tokens(t: T, p: PlayerView): HTMLElement {
  const n = Math.max(t.game.tokensToWin, p.tokens);
  const dots: Child[] = [];
  for (let i = 0; i < n; i++) dots.push(h('span', { class: `token${i < p.tokens ? ' on' : ''}` }));
  return h('span', { class: 'tokens', title: `${p.tokens} of ${t.game.tokensToWin} tokens`, 'aria-label': `${p.tokens} of ${t.game.tokensToWin} tokens` }, dots);
}

function badges(t: T, p: PlayerView): Child[] {
  const out: Child[] = [];
  if (p.round === 'out') out.push(pill('Out', 'pill-out'));
  if (p.round === 'sittingOut') out.push(pill('Sitting out'));
  if (!p.connected) out.push(pill('Away', 'pill-warn'));
  for (const id of p.statuses) out.push(pill(t.pack.rules.statuses?.[id]?.label ?? id, 'pill-status'));
  return out;
}

function handCards(t: T, p: PlayerView, size: CardOpts['size']): Child[] {
  // Big hands (Exploding Kittens) show as a pile with a count, plus any cards you know.
  if (p.hand.count > 4) {
    return [
      h('div', { class: 'zone-stack' }, back(t, `hand:${p.seat}:pile:${t.game.round}`, { size }), h('span', { class: 'zone-count' }, p.hand.count)),
      ...p.hand.known.map((k) => face(t, k.card, { size: 'sm' })),
    ];
  }
  const known = new Map(p.hand.known.map((k) => [k.index, k.card]));
  const out: Child[] = [];
  for (let i = 0; i < p.hand.count; i++) {
    const card = known.get(i);
    out.push(card ? face(t, card, { size }) : back(t, `hand:${p.seat}:${i}:${t.game.round}`, { size }));
  }
  return out;
}

function seat(t: T, p: PlayerView): HTMLElement {
  const choosable = t.prompt?.kind === 'choosePlayer' && t.prompt.choices.includes(p.seat);
  const isTurn = t.game.phase === 'round' && t.game.turnSeat === p.seat;
  const winner = t.game.result?.winners.includes(p.seat) && t.game.phase !== 'round';
  const cls =
    ['seat', isTurn ? 'is-turn' : '', p.round !== 'in' && t.game.phase === 'round' ? 'is-out' : '', choosable ? 'is-choice' : '', winner ? 'is-winner' : '']
      .filter(Boolean)
      .join(' ') + seatFlash(t, p.seat);
  const body = [
    h('div', { class: 'seat-head' }, avatar(p.name, p.color), h('span', { class: 'seat-name' }, p.name), tokens(t, p)),
    h('div', { class: 'seat-badges' }, badges(t, p), isTurn ? pill('Turn', 'pill-turn') : null),
    h(
      'div',
      { class: 'seat-cards' },
      h('div', { class: 'seat-hand', 'aria-label': `${p.name}'s hand` }, handCards(t, p, 'md')),
      h('div', { class: 'played-row', 'aria-label': `Played by ${p.name}` }, p.played.map((c) => face(t, c, { size: 'sm' }))),
    ),
  ];
  if (choosable) {
    return h('button', { type: 'button', class: cls, 'aria-label': `Choose ${p.name}`, onclick: () => answer(t, p.seat) }, body);
  }
  return h('div', { class: cls }, body);
}

function zoneTitle(t: T, id: string): string {
  const label = t.pack.rules.zones[id]?.label ?? id;
  const short = label.replace(/^the /i, '');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** The shared zones. `compact` (the round table) stacks piles sooner and leaves out empty side piles. */
function center(t: T, cls = 'center', compact = false): HTMLElement {
  const zones = Object.keys(t.pack.rules.zones)
    .map((id) => [id, t.game.zones[id]] as const)
    .filter((entry): entry is readonly [string, ZoneView] => Boolean(entry[1]));
  return h(
    'div',
    { class: cls },
    zones.map(([id, zone]) => {
      const hidden = t.pack.rules.zones[id]?.visibility === 'hidden';
      if (!hidden && zone.count === 0) return null;
      if (compact && hidden && zone.count === 0 && id !== 'deck') return null;
      let cards: Child;
      if (!hidden && zone.count > (compact ? 2 : 4)) {
        // A long public pile (a discard pile) shows its newest card on top.
        cards = h('div', { class: 'zone-stack' }, face(t, zone.known.at(-1)!.card, { size: 'md' }), h('span', { class: 'zone-count' }, zone.count));
      } else if (!hidden) {
        cards = h('div', { class: 'zone-cards' }, zone.known.map((k) => face(t, k.card, { size: 'md' })));
      } else if (zone.count === 0) {
        cards = h('div', { class: 'card card-md card-empty' }, h('span', null, 'Empty'));
      } else if (zone.count === 1 && zone.known[0]) {
        cards = face(t, zone.known[0].card, { size: 'md', note: 'You know' });
      } else {
        const shuffling = t.events.some((e) => e.kind === 'shuffle' && e.zone === id);
        cards = h(
          'div',
          { class: `zone-stack${shuffling ? ' is-shuffling' : ''}` },
          back(t, `zone:${id}`, { size: 'md' }),
          h('span', { class: 'zone-count' }, zone.count),
        );
      }
      const knownList = hidden && zone.count > 1 && zone.known.length ? h('p', { class: 'zone-known' }, knownText(t, zone)) : null;
      return h('div', { class: 'zone' }, h('span', { class: 'zone-label' }, zoneTitle(t, id)), cards, knownList);
    }),
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/**
 * The cards you know in a hidden pile, top first. Top cards in a row read as a plain list, a
 * card further down says how far. The engine only sends positions you can know.
 */
function knownText(t: T, zone: ZoneView): string {
  const name = (cardId: string) => def(t, cardId).name;
  if (zone.known.every((k, i) => k.index === i)) {
    const names = zone.known.map((k) => name(k.card.cardId)).join(', ');
    return zone.known.length === 1 ? `The top card you saw: ${names}` : `The top cards you saw: ${names}`;
  }
  return `You know: ${zone.known.map((k) => `${name(k.card.cardId)} (${ordinal(k.index + 1)} from the top)`).join(', ')}`;
}

/** Your hand: cards to click when you are asked to play, cards to read otherwise. */
function yourHand(t: T, size: CardOpts['size'] = t.game.hand.length > 5 ? 'md' : 'lg'): HTMLElement[] {
  const p = t.prompt;
  const playing = p?.kind === 'play';
  const multi = playing && p.max > 1;
  return t.game.hand.map((card) => {
    if (!playing) return face(t, card, { size });
    const picked = t.memo.picked.includes(card.uid);
    return face(t, card, {
      size,
      active: multi ? picked : true,
      onClick: () => (multi ? togglePick(t, card.uid) : openHandCard(t, card)),
    });
  });
}

function yourArea(t: T, me: PlayerView): HTMLElement {
  const p = t.prompt;
  const choosable = p?.kind === 'choosePlayer' && p.choices.includes(me.seat);
  const hand = yourHand(t);
  const isTurn = t.game.phase === 'round' && t.game.turnSeat === me.seat;
  // Glows while the game waits on you, in your turn or not.
  const asked = t.game.phase === 'round' && Boolean(p);
  return h(
    'div',
    { class: `you${isTurn ? ' is-turn' : ''}${asked ? ' is-asked' : ''}${choosable ? ' is-choice' : ''}${seatFlash(t, me.seat)}` },
    h(
      'div',
      { class: 'seat-head' },
      avatar(me.name, me.color),
      h('span', { class: 'seat-name' }, `${me.name} (you)`),
      h('span', { class: 'seat-badges' }, badges(t, me)),
      tokens(t, me),
    ),
    h(
      'div',
      { class: 'you-cards' },
      h('div', { class: 'hand', 'aria-label': 'Your hand' }, hand.length ? hand : h('p', { class: 'muted small' }, 'No cards in hand.')),
      me.played.length
        ? h('div', { class: 'you-played' }, h('span', { class: 'zone-label' }, 'Played'), h('div', { class: 'played-row' }, me.played.map((c) => face(t, c, { size: 'sm' }))))
        : null,
    ),
  );
}

function togglePick(t: T, uid: string): void {
  const p = t.game.prompt;
  if (p?.kind !== 'play') return;
  const picked = t.memo.picked;
  t.memo.picked = picked.includes(uid) ? picked.filter((u) => u !== uid) : picked.length < p.max ? [...picked, uid] : picked;
  // Redraw through the session's listeners is not triggered by local state, so do it here.
  t.ctx.redraw();
}

/** Cards whose onDiscard knocks out their own holder, like the King Cat. */
function knocksYouOut(card: CardDef): boolean {
  return (card.onDiscard ?? []).some((op) => op.op === 'eliminate' && op.who === 'self');
}

/** A card in your hand opens large, so you can read it, with Play and Back. */
function openHandCard(t: T, card: VisibleCard): void {
  const d = def(t, card.cardId);
  const p = t.prompt;
  const origin = t.origins.get(card.cardId);
  if (p?.kind !== 'play' || !p.alone.includes(card.uid)) return showCard(t.lp, d, { origin });
  const out = knocksYouOut(d);
  showCard(t.lp, d, {
    origin,
    note: out ? 'Playing it puts it face up in front of you: you will be out of this round.' : undefined,
    actions: [{ label: out ? `Play ${d.name} and go out` : `Play ${d.name}`, kind: out ? 'danger' : 'primary', onClick: () => answer(t, [card.uid]) }],
  });
}

/** Plays cards, after a warning when a single card would knock you out. */
async function playCards(t: T, uids: string[]): Promise<void> {
  const d = def(t, t.known.get(uids[0]!) ?? '');
  if (uids.length === 1 && knocksYouOut(d)) {
    const sure = await confirmDialog(`Play ${d.name}?`, `${d.text} You will be out of this round.`, `Play ${d.name}`, 'Keep it');
    if (!sure) return;
  }
  answer(t, uids);
}

function react(t: T, uid: string, key: string): void {
  t.memo.reacted = key;
  t.ctx.session.act({ kind: 'react', uid });
  t.ctx.redraw();
}

/** The play in its reaction window, a bar for the time left, and a button to react with. */
function windowBanner(t: T): HTMLElement | null {
  const w = t.game.window;
  if (!w || t.game.phase !== 'round') return null;
  const mine = w.seat === t.game.you;
  const cards = w.cards.map((c) => def(t, c.cardId).name).join(' and ');
  const key = `${w.cards.map((c) => c.uid).join()}:${w.reactions}`;
  const uid = t.game.reactWith[0];
  const headline = w.canceled
    ? `${mine ? 'Your' : `${name(t, w.seat)}'s`} ${cards} is stopped.`
    : `${mine ? 'You' : name(t, w.seat)} played ${cards}.`;
  return h(
    'div',
    { class: `window${w.canceled ? ' is-canceled' : ''}`, role: 'status' },
    h('div', { class: 'window-cards' }, w.cards.map((c) => face(t, c, { size: 'sm' }))),
    h(
      'div',
      { class: 'window-text' },
      h('strong', null, headline),
      h('span', { class: 'muted small' }, w.canceled ? 'Another reaction can bring it back.' : 'Anyone can react until the bar runs out.'),
    ),
    uid
      ? h(
          'button',
          { type: 'button', class: 'btn btn-danger', disabled: t.memo.reacted === key, onclick: () => react(t, uid, key) },
          `${def(t, t.known.get(uid) ?? '').name}!`,
        )
      : null,
    // The bar is timed by the host's time left when this view was made.
    h('div', { class: 'window-bar', 'aria-hidden': 'true' }, h('span', { style: `animation-duration: ${w.remainingMs}ms` })),
  );
}

function promptBar(t: T): HTMLElement | null {
  const p = t.prompt;
  if (!p || t.game.phase !== 'round') return null;
  const source = p.combo ?? (p.source ? def(t, p.source).name : null);
  const titled = (text: string) => (source ? `${source}: ${text}` : text);
  let title: string;
  let body: Child = null;
  switch (p.kind) {
    case 'play': {
      const pass =
        p.min === 0 ? h('button', { type: 'button', class: 'btn', onclick: () => answer(t, []) }, p.pass ?? 'Pass') : null;
      if (p.max === 1) {
        title = 'Your turn. Play one of your cards.';
        body = [h('p', { class: 'muted small' }, 'Click a card in your hand to read it and play it.'), pass];
        break;
      }
      const picked = t.memo.picked;
      const ids = picked.map((uid) => t.known.get(uid) ?? '');
      const combo = picked.length > 1 ? findCombo(p.combos, ids) : undefined;
      const valid = picked.length === 1 ? p.alone.includes(picked[0]!) : Boolean(combo);
      const label = valid
        ? combo
          ? `Play ${combo.name.toLowerCase()}`
          : `Play ${def(t, ids[0]!).name}`
        : picked.length
          ? 'Not a play'
          : 'Pick a card';
      title = p.combos.length ? 'Your turn. Pick a card to play, or several for a combo.' : 'Your turn. Pick cards to play.';
      body = [
        h(
          'div',
          { class: 'choices' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: !valid, onclick: () => void playCards(t, picked) }, label),
          pass,
        ),
        // One picked card: its text, so you can read before you play.
        picked.length === 1 ? h('p', { class: 'picked-text' }, h('strong', null, def(t, ids[0]!).name), ` ${def(t, ids[0]!).text}`) : null,
        p.combos.length
          ? h('p', { class: 'muted small' }, `Combos: ${p.combos.map((c) => `${c.name} (${c.size} ${c.match === 'same' ? 'alike' : 'different'})`).join(', ')}.`)
          : null,
      ];
      break;
    }
    case 'choosePlayer':
      title = titled('choose a player.');
      body = h(
        'div',
        { class: 'choices' },
        p.choices.map((seat) => {
          const pl = t.game.players[seat]!;
          return h('button', { type: 'button', class: 'btn choice', onclick: () => answer(t, seat) }, avatar(pl.name, pl.color), seat === t.game.you ? `${pl.name} (you)` : pl.name);
        }),
      );
      break;
    case 'guess':
      title = titled('guess a number.');
      body = h(
        'div',
        { class: 'choices' },
        p.choices.map((value) => {
          const cards = t.pack.cards.filter((c) => c.value === value);
          const names = cards.map((c) => c.name);
          const shown = cards.find((c) => c.valueLabel)?.valueLabel ?? value;
          return h('button', { type: 'button', class: 'btn choice choice-guess', onclick: () => answer(t, value) }, h('strong', null, shown), names.length ? h('span', { class: 'choice-sub' }, names.join(', ')) : null);
        }),
      );
      break;
    case 'choosePosition': {
      // The card you are placing stays in sight, so you know what you are putting where.
      const cardId = p.card ? t.known.get(p.card) : undefined;
      const what = !cardId ? 'the card' : cardId === p.source ? 'it' : def(t, cardId).name;
      title = titled(`where does ${what} go? 1 is the top of the pile.`);
      const buttons: Child[] = [];
      for (let i = 0; i < p.choices; i++) {
        const label = i === 0 ? '1 (top)' : i === p.choices - 1 ? `${i + 1} (bottom)` : String(i + 1);
        buttons.push(h('button', { type: 'button', class: 'btn btn-sm choice', onclick: () => answer(t, i) }, label));
      }
      body = h(
        'div',
        { class: 'position-choice' },
        cardId ? face(t, { uid: p.card!, cardId }, { size: 'md' }) : null,
        h('div', { class: 'choices choices-dense' }, buttons),
      );
      break;
    }
    case 'chooseCard':
      title = titled(p.text ?? 'pick a card.');
      body = h(
        'div',
        { class: 'choice-cards' },
        p.choices.map((uid, i) => {
          const cardId = t.known.get(uid);
          return cardId
            ? face(t, { uid, cardId }, { size: 'md', active: true, onClick: () => answer(t, uid) })
            : h('button', { type: 'button', class: 'card card-md card-button card-back is-active', 'aria-label': `Face-down card ${i + 1}`, onclick: () => answer(t, uid) }, h('img', { src: t.lp.asset(t.lp.pack.art.back), alt: '' }));
        }),
      );
      break;
    case 'nameCard':
      title = titled('name a card.');
      body = h('div', { class: 'choices' }, p.choices.map((id) => h('button', { type: 'button', class: 'btn choice', onclick: () => answer(t, id) }, def(t, id).name)));
      break;
    case 'confirm':
      title = titled(p.text ?? 'Are you sure?');
      body = h(
        'div',
        { class: 'choices' },
        h('button', { type: 'button', class: 'btn btn-primary choice', onclick: () => answer(t, true) }, 'Yes'),
        h('button', { type: 'button', class: 'btn choice', onclick: () => answer(t, false) }, 'No'),
      );
      break;
  }
  return h('div', { class: 'prompt-bar', role: 'group', 'aria-label': title }, h('p', { class: 'prompt-title' }, title), body);
}

/** Whose move it is, in words. The host gets a button to take out a player who is away. */
function turnStatus(t: T): HTMLElement | null {
  const g = t.game;
  if (g.phase !== 'round' || !g.waiting) return null;
  const w = g.waiting;
  const player = g.players[w.seat]!;
  if (w.seat === g.you) return h('span', { class: 'turn-banner is-you' }, t.prompt ? 'Your move' : 'Sending...');
  return h(
    'span',
    { class: 'turn-banner' },
    player.connected ? `Waiting for ${player.name} ${WAITING_FOR[w.kind]}.` : `${player.name} is away. Waiting for them ${WAITING_FOR[w.kind]}.`,
    kickButton(t, player),
  );
}

function kickButton(t: T, player: PlayerView): HTMLElement | null {
  if (player.connected || !t.ctx.session.isHost) return null;
  return h(
    'button',
    { type: 'button', class: 'btn btn-sm', onclick: () => t.ctx.session.act({ kind: 'kickForRound', playerId: player.playerId }) },
    `Take ${player.name} out of this round`,
  );
}

/** Round flags change the rules for everyone, so they stay in sight. */
function flagsRow(t: T): HTMLElement | null {
  const g = t.game;
  if (g.phase !== 'round' || !g.flags.length) return null;
  return h(
    'div',
    { class: 'table-flags' },
    g.flags.map((id) => {
      const f = t.pack.rules.flags?.[id];
      return h('p', { class: 'table-flag' }, h('strong', null, f?.label ?? id), f?.text ? h('span', null, f.text) : null);
    }),
  );
}

/** The latest event, so nobody has to read the log to follow along. A new one slides in. */
function ticker(t: T, cls: string): HTMLElement | null {
  const last = t.game.phase === 'round' ? t.game.log.at(-1) : undefined;
  if (!last) return null;
  return h('p', { class: `${cls}${last.private ? ' is-private' : ''}${t.tickerNew ? ' is-new' : ''}`, 'aria-hidden': 'true' }, last.text);
}

function roundInfo(t: T): HTMLElement {
  const g = t.game;
  return h(
    'div',
    { class: 'table-info' },
    h('strong', null, g.deciding ? 'Deciding round' : `Round ${g.round}`),
    h('span', { class: 'muted' }, g.tokensToWin === 1 ? 'One round decides the game' : `First to ${g.tokensToWin} tokens wins`),
  );
}

function layoutToggle(t: T): HTMLElement {
  const current = tableLayout();
  const option = (value: TableLayout, label: string) =>
    h('button', { type: 'button', class: `seg${current === value ? ' is-on' : ''}`, 'aria-pressed': String(current === value), onclick: () => setTableLayout(t, value) }, label);
  return h('div', { class: 'layout-toggle', role: 'group', 'aria-label': 'Table layout' }, option('classic', 'Classic'), option('round', 'Round table'));
}

function statusBar(t: T): HTMLElement {
  return h('div', { class: 'table-status' }, roundInfo(t), turnStatus(t), layoutToggle(t), flagsRow(t), ticker(t, 'ticker'));
}

// ---------- Round table ----------

function roundTop(t: T): HTMLElement {
  return h('div', { class: 'rt-top' }, roundInfo(t), layoutToggle(t));
}

/** Seats around the oval in turn order, clockwise, you at the bottom. Angles in degrees, 90 is the bottom. */
function seating(t: T): { p: PlayerView; angle: number }[] {
  const players = t.game.players;
  const you = t.game.you;
  if (you === null) return players.map((p, i) => ({ p, angle: 90 + (360 * i) / players.length }));
  const others = opponentOrder(t);
  return [{ p: players[you]!, angle: 90 }, ...others.map((p, i) => ({ p, angle: 90 + (360 * (i + 1)) / (others.length + 1) }))];
}

/** A point on the oval, `k` = 1 being its rim, as CSS percentages. */
function onOval(angle: number, k: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: 50 + 50 * k * Math.cos(rad), y: 50 + 50 * k * Math.sin(rad) };
}

function roundFelt(t: T): HTMLElement {
  const g = t.game;
  const seats = seating(t);
  // Whoever the game waits on, or whose turn it is while a reaction window runs.
  const focus = g.phase === 'round' ? (g.waiting?.seat ?? g.turnSeat) : null;
  const target = seats.find((s) => s.p.seat === focus);
  const flash = focus !== t.memo.focus;
  t.memo.focus = focus;

  const many = seats.length > 6;
  const rim = target ? onOval(target.angle, 1) : null;
  return h(
    'div',
    { class: `rt-stage${many ? ' rt-many' : ''}` },
    h(
      'div',
      { class: 'rt-felt', style: rim ? `--spot-x: ${rim.x.toFixed(2)}%; --spot-y: ${rim.y.toFixed(2)}%` : null },
      h('div', { class: 'rt-center' }, turnLabel(t), center(t, 'rt-zones', true), flagsRow(t), ticker(t, 'rt-ticker')),
      seats.map(({ p, angle }) => roundSeat(t, p, angle, p.seat === focus, flash)),
    ),
  );
}

/** The big line in the middle of the table: whose move it is. */
function turnLabel(t: T): HTMLElement | null {
  const g = t.game;
  if (g.phase !== 'round') return h('p', { class: 'rt-turn' }, g.phase === 'gameOver' ? 'Game over' : 'Round over');
  const w = g.waiting;
  if (!w) {
    if (g.window) return h('p', { class: 'rt-turn' }, 'Anyone can react');
    return h('p', { class: 'rt-turn' }, g.turnSeat === g.you ? 'Your turn' : `${name(t, g.turnSeat)}'s turn`);
  }
  const player = g.players[w.seat]!;
  if (w.seat === g.you) {
    const text = !t.prompt ? 'Sending...' : w.kind === 'play' ? 'Your turn' : 'Your move';
    return h('p', { class: 'rt-turn is-you' }, text);
  }
  if (!player.connected) return h('p', { class: 'rt-turn' }, `${player.name} is away`);
  const text = w.kind === 'play' && w.seat === g.turnSeat ? `${player.name}'s turn` : `${player.name} is about ${WAITING_FOR[w.kind]}`;
  return h('p', { class: 'rt-turn' }, text);
}

function roundSeat(t: T, p: PlayerView, angle: number, focused: boolean, flash: boolean): HTMLElement {
  const g = t.game;
  const isMe = p.seat === g.you;
  const isTurn = g.phase === 'round' && g.turnSeat === p.seat;
  const choosable = t.prompt?.kind === 'choosePlayer' && t.prompt.choices.includes(p.seat);
  const winner = g.result?.winners.includes(p.seat) && g.phase !== 'round';
  const out = p.round !== 'in' && g.phase === 'round';
  const cls =
    ['rt-seat', isMe ? 'is-me' : '', focused ? 'is-focus' : '', focused && flash ? 'is-new' : '', out ? 'is-out' : '', choosable ? 'is-choice' : '', winner ? 'is-winner' : '']
      .filter(Boolean)
      .join(' ') + seatFlash(t, p.seat);
  const at = onOval(angle, 1);
  const body = [
    h('div', { class: 'rt-seat-head' }, avatar(p.name, p.color), h('span', { class: 'rt-seat-name' }, isMe ? `${p.name} (you)` : p.name), tokens(t, p)),
    h('div', { class: 'rt-seat-meta' }, badges(t, p), isTurn ? pill('Turn', 'pill-turn') : focused ? pill('Deciding', 'pill-turn') : null),
    h(
      'div',
      { class: 'rt-seat-cards' },
      // Your own hand is below the table, big.
      isMe ? null : h('div', { class: 'seat-hand', 'aria-label': `${p.name}'s hand` }, handCards(t, p, 'sm')),
      p.played.length ? h('div', { class: 'rt-played', 'aria-label': `Played by ${p.name}` }, p.played.map((c) => face(t, c, { size: 'sm' }))) : null,
    ),
  ];
  // The arrow on the focused seat points at it from the middle; CSS works out its angle.
  const rad = (angle * Math.PI) / 180;
  const style = `left: ${at.x.toFixed(2)}%; top: ${at.y.toFixed(2)}%; --c: ${Math.cos(rad).toFixed(4)}; --s: ${Math.sin(rad).toFixed(4)}`;
  if (choosable) {
    return h('button', { type: 'button', class: cls, style, 'aria-label': `Choose ${isMe ? 'yourself' : p.name}`, onclick: () => answer(t, p.seat) }, body);
  }
  return h('div', { class: cls, style }, body);
}

/**
 * The bar pinned to the bottom of the screen: what the game asks you (or who it waits on, or the
 * play others can react to) beside your hand. It keeps its place, so the hand never moves away.
 */
function roundDock(t: T, watching: HTMLElement): HTMLElement {
  const g = t.game;
  const me = g.you !== null ? g.players[g.you]! : null;
  const yourMove = g.phase === 'round' && me !== null && g.waiting?.seat === me.seat && Boolean(t.prompt);
  const hand = me ? yourHand(t, 'md') : [];
  return h(
    'div',
    { class: `rt-dock${yourMove ? ' is-turn' : ''}` },
    h('div', { class: 'rt-ask' }, promptBar(t) ?? windowBanner(t) ?? waitingNote(t)),
    me
      ? h(
          'div',
          { class: 'rt-hand' },
          h('span', { class: 'zone-label' }, 'Your hand'),
          h('div', { class: `hand${hand.length > 5 ? ' is-fan' : ''}`, 'aria-label': 'Your hand' }, hand.length ? hand : h('p', { class: 'muted small' }, 'No cards in hand.')),
        )
      : watching,
  );
}

/** When nothing is asked of you: who the game waits on, in words. */
function waitingNote(t: T): HTMLElement {
  const g = t.game;
  if (g.phase !== 'round') return h('p', { class: 'rt-wait' }, g.phase === 'gameOver' ? 'The game is over.' : 'The round is over.');
  const w = g.waiting;
  if (!w) return h('p', { class: 'rt-wait' }, `${name(t, g.turnSeat)}'s turn.`);
  const player = g.players[w.seat]!;
  if (w.seat === g.you) return h('p', { class: 'rt-wait' }, 'Sending...');
  return h(
    'div',
    { class: 'rt-wait' },
    h('p', null, player.connected ? `Waiting for ${player.name} ${WAITING_FOR[w.kind]}.` : `${player.name} is away. Waiting for them ${WAITING_FOR[w.kind]}.`),
    kickButton(t, player),
  );
}

function result(t: T): HTMLElement | null {
  const g = t.game;
  if (g.phase === 'round' || !g.result) return null;
  const isHost = t.ctx.session.isHost;
  const r = g.result;
  const over = g.phase === 'gameOver';
  const winners = over ? g.winners : r.winners;
  const names = winners.map((s) => name(t, s));
  const who = names.length ? names.join(' and ') : 'Nobody';
  const verb = names.length > 1 ? (over ? 'win' : 'share') : 'wins';
  const headline = over ? `${who} ${verb} the game!` : `${who} ${verb} the round.`;

  let reason: Child = null;
  if (r.by === 'lastStanding') reason = h('p', null, `${r.winners.map((s) => name(t, s)).join(' and ')} is the last one standing.`);
  if (r.by === 'nobodyLeft') reason = h('p', null, 'Nobody was left in the round.');
  if (r.by === 'showdown' && r.showdown) {
    reason = h(
      'div',
      { class: 'showdown' },
      h('p', null, `${g.zones.deck?.count === 0 ? 'The draw pile ran out. ' : ''}Showdown${r.lowestWins ? ', and the lowest card wins' : ''}:`),
      h(
        'ul',
        { class: 'showdown-list' },
        [...r.showdown]
          .sort((a, b) => showdownScore(b.value, r.lowestWins) - showdownScore(a.value, r.lowestWins))
          .map((e) =>
            h(
              'li',
              { class: r.winners.includes(e.seat) ? 'is-winner' : '' },
              h('span', { class: 'showdown-name' }, name(t, e.seat)),
              h('span', null, e.cardId ? def(t, e.cardId).name : 'no card'),
              h('span', { class: 'muted' }, shownValue(t, e.cardId, e.value)),
            ),
          ),
      ),
      r.tieBreak
        ? h(
            'p',
            { class: 'muted small' },
            `Tie-break by ${r.tieBreak.rule === 'sumPlayed' ? 'total of played cards' : 'highest played card'}: `,
            r.tieBreak.scores.map((s) => `${name(t, s.seat)} ${Math.max(s.score, 0)}`).join(', '),
            '.',
          )
        : null,
    );
  }

  const blocked = t.lobby.startBlocked;
  let actions: Child;
  if (over) {
    actions = isHost
      ? h(
          'div',
          { class: 'result-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => t.ctx.session.act({ kind: 'rematch' }) }, 'Rematch'),
          h('button', { type: 'button', class: 'btn btn-lg', onclick: () => t.ctx.session.act({ kind: 'endGame' }) }, 'Back to lobby'),
        )
      : h('p', { class: 'muted' }, 'Waiting for the host to start a rematch or go back to the lobby.');
  } else {
    actions = isHost
      ? h(
          'div',
          { class: 'result-actions' },
          blocked ? h('p', { class: 'start-reason' }, blocked) : null,
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: Boolean(blocked), onclick: () => t.ctx.session.act({ kind: 'nextRound' }) }, g.deciding ? 'Start deciding round' : 'Next round'),
        )
      : h('p', { class: 'muted' }, blocked ?? 'Waiting for the host to start the next round.');
  }
  return h(
    'div',
    { class: `result${over ? ' result-game' : ''}`, role: 'status' },
    h('h2', null, headline),
    reason,
    g.deciding && !over ? h('p', null, `${g.deciding.map((s) => name(t, s)).join(' and ')} reached the target together and play a deciding round.`) : null,
    actions,
  );
}

/** A showdown value in words. A card that counted as its own value shows its label, like ∞. */
function shownValue(t: T, cardId: string, v: number | 'highest' | 'lowest'): string {
  if (v === 'highest') return 'beats every card';
  if (v === 'lowest') return 'loses to every card';
  const d = cardId ? def(t, cardId) : undefined;
  return `value ${d && d.value === v ? valueText(d) : v}`;
}

/** The game log for the side column. Private lines are only in your view. */
export function logPanel(game: GameView): HTMLElement {
  const lines = h(
    'div',
    { class: 'log', role: 'log', 'aria-live': 'polite' },
    game.log.map((e) => {
      const heading = /^(Round \d+|Deciding round:.*)\.$/.test(e.text);
      return h('p', { class: `log-line${e.private ? ' is-private' : ''}${heading ? ' log-round' : ''}`, title: e.private ? 'Only you see this' : null }, e.text);
    }),
  );
  return h('section', { class: 'panel log-panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Game log')), lines);
}

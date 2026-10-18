/**
 * The game table, drawn from the latest game view: opponents along the top, shared zones in
 * the middle, your cards at the bottom, a prompt bar when the game asks you something, and
 * round and game results. Clients never run rules, they only draw views and answer prompts.
 */
import { findCombo } from '../../engine/ops/flow';
import type { GameView, PlayerView, Prompt, PromptKind, Seat, VisibleCard, ZoneView } from '../../engine/types';
import type { LobbyView } from '../../net/protocol';
import type { CardDef, LoadedPack, Pack } from '../../packs/types';
import { mergeSelection } from '../../session/lobby';
import { avatar, pill } from '../components/bits';
import { cardBack, cardFace, type CardOpts } from '../components/card';
import { confirmDialog } from '../components/dialog';
import { h, type Child } from '../dom';
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
}

export const newTableMemo = (): TableMemo => ({ seen: new Set(), answered: null, picked: [], reacted: null });

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
  const pack = mergeSelection(lp, lobby.addons).pack ?? lp.pack;
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
  };
  if (game.prompt?.id !== memo.answered) memo.picked = memo.picked.filter((uid) => game.hand.some((c) => c.uid === uid));

  const content = h(
    'section',
    { class: 'panel table' },
    statusBar(t),
    windowBanner(t),
    result(t),
    h('div', { class: 'seats' }, opponentOrder(t).map((p) => seat(t, p))),
    center(t),
    promptBar(t),
    game.you !== null ? yourArea(t, game.players[game.you]!) : h('p', { class: 'muted small spectating' }, 'You are watching this game.'),
  );
  for (const uid of t.fresh) memo.seen.add(uid);
  return [content];
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
  return cardFace(t.lp, def(t, card.cardId), { ...opts, enter });
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
  const cls = ['seat', isTurn ? 'is-turn' : '', p.round !== 'in' && t.game.phase === 'round' ? 'is-out' : '', choosable ? 'is-choice' : '', winner ? 'is-winner' : '']
    .filter(Boolean)
    .join(' ');
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

function center(t: T): HTMLElement {
  const zones = Object.keys(t.pack.rules.zones)
    .map((id) => [id, t.game.zones[id]] as const)
    .filter((entry): entry is readonly [string, ZoneView] => Boolean(entry[1]));
  return h(
    'div',
    { class: 'center' },
    zones.map(([id, zone]) => {
      const hidden = t.pack.rules.zones[id]?.visibility === 'hidden';
      if (!hidden && zone.count === 0) return null;
      let cards: Child;
      if (!hidden && zone.count > 4) {
        // A long public pile (a discard pile) shows its newest card on top.
        cards = h('div', { class: 'zone-stack' }, face(t, zone.known.at(-1)!.card, { size: 'md' }), h('span', { class: 'zone-count' }, zone.count));
      } else if (!hidden) {
        cards = h('div', { class: 'zone-cards' }, zone.known.map((k) => face(t, k.card, { size: 'md' })));
      } else if (zone.count === 0) {
        cards = h('div', { class: 'card card-md card-empty' }, h('span', null, 'Empty'));
      } else if (zone.count === 1 && zone.known[0]) {
        cards = face(t, zone.known[0].card, { size: 'md', note: 'You know' });
      } else {
        cards = h('div', { class: 'zone-stack' }, back(t, `zone:${id}`, { size: 'md' }), h('span', { class: 'zone-count' }, zone.count));
      }
      const knownList =
        hidden && zone.count > 1 && zone.known.length
          ? h(
              'p',
              { class: 'zone-known' },
              `You know: ${zone.known.map((k) => `${def(t, k.card.cardId).name} at ${k.index + 1}`).join(', ')}`,
            )
          : null;
      return h('div', { class: 'zone' }, h('span', { class: 'zone-label' }, zoneTitle(t, id)), cards, knownList);
    }),
  );
}

function yourArea(t: T, me: PlayerView): HTMLElement {
  const p = t.prompt;
  const playing = p?.kind === 'play';
  const multi = playing && p.max > 1;
  const choosable = p?.kind === 'choosePlayer' && p.choices.includes(me.seat);
  const size = t.game.hand.length > 5 ? 'md' : 'lg';
  const hand = t.game.hand.map((card) => {
    if (!playing) return face(t, card, { size });
    const picked = t.memo.picked.includes(card.uid);
    return face(t, card, {
      size,
      active: multi ? picked : true,
      onClick: () => (multi ? togglePick(t, card.uid) : void playCard(t, card)),
    });
  });
  const isTurn = t.game.phase === 'round' && t.game.turnSeat === me.seat;
  return h(
    'div',
    { class: `you${isTurn ? ' is-turn' : ''}${choosable ? ' is-choice' : ''}` },
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

async function playCard(t: T, card: VisibleCard): Promise<void> {
  await playCards(t, [card.uid]);
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
        body = [h('p', { class: 'muted small' }, 'Click a card in your hand. Click any other card to read it.'), pass];
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
          const names = t.pack.cards.filter((c) => c.value === value).map((c) => c.name);
          return h('button', { type: 'button', class: 'btn choice choice-guess', onclick: () => answer(t, value) }, h('strong', null, value), names.length ? h('span', { class: 'choice-sub' }, names.join(', ')) : null);
        }),
      );
      break;
    case 'choosePosition': {
      title = titled('where does the card go? 1 is the top of the pile.');
      const buttons: Child[] = [];
      for (let i = 0; i < p.choices; i++) {
        const label = i === 0 ? '1 (top)' : i === p.choices - 1 ? `${i + 1} (bottom)` : String(i + 1);
        buttons.push(h('button', { type: 'button', class: 'btn btn-sm choice', onclick: () => answer(t, i) }, label));
      }
      body = h('div', { class: 'choices choices-dense' }, buttons);
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

function statusBar(t: T): HTMLElement {
  const g = t.game;
  const info = g.deciding ? `Deciding round` : `Round ${g.round}`;
  let status: Child = null;
  if (g.phase === 'round' && g.waiting) {
    const w = g.waiting;
    const player = g.players[w.seat]!;
    if (w.seat === g.you) {
      status = h('span', { class: 'turn-banner is-you' }, t.prompt ? 'Your move' : 'Sending...');
    } else {
      status = h(
        'span',
        { class: 'turn-banner' },
        player.connected ? `Waiting for ${player.name} ${WAITING_FOR[w.kind]}.` : `${player.name} is away. Waiting for them ${WAITING_FOR[w.kind]}.`,
        !player.connected && t.ctx.session.isHost
          ? h(
              'button',
              { type: 'button', class: 'btn btn-sm', onclick: () => t.ctx.session.act({ kind: 'kickForRound', playerId: player.playerId }) },
              `Take ${player.name} out of this round`,
            )
          : null,
      );
    }
  }
  // The latest event, so nobody has to read the log to follow along.
  const last = g.phase === 'round' ? g.log.at(-1) : undefined;
  return h(
    'div',
    { class: 'table-status' },
    h(
      'div',
      { class: 'table-info' },
      h('strong', null, info),
      h('span', { class: 'muted' }, g.tokensToWin === 1 ? 'One round decides the game' : `First to ${g.tokensToWin} tokens wins`),
    ),
    status,
    last ? h('p', { class: `ticker${last.private ? ' is-private' : ''}`, 'aria-hidden': 'true' }, last.text) : null,
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
      h('p', null, 'The draw pile ran out. Showdown:'),
      h(
        'ul',
        { class: 'showdown-list' },
        [...r.showdown]
          .sort((a, b) => rank(b.value) - rank(a.value))
          .map((e) =>
            h(
              'li',
              { class: r.winners.includes(e.seat) ? 'is-winner' : '' },
              h('span', { class: 'showdown-name' }, name(t, e.seat)),
              h('span', null, e.cardId ? def(t, e.cardId).name : 'no card'),
              h('span', { class: 'muted' }, e.value === 'highest' ? 'counts highest' : e.value === 'lowest' ? 'counts lowest' : `value ${e.value}`),
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

const rank = (v: number | 'highest' | 'lowest') => (v === 'highest' ? Infinity : v === 'lowest' ? -Infinity : v);

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

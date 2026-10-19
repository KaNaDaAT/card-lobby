/**
 * The lobby, drawn from the latest view. The host gets the gallery and live controls, everyone
 * else sees the same game, addons and options read-only.
 */
import type { GameView } from '../../engine/types';
import type { Identity } from '../../identity';
import type { LobbyView } from '../../net/protocol';
import { resolveCount } from '../../packs/count';
import { withUploads } from '../../packs/custom';
import { addonProblems, cardOrigins } from '../../packs/merge';
import type { Count, LoadedAddon, LoadedPack, OptionDef, OptionValue, Pack } from '../../packs/types';
import { AUTO, MAX_CARD_COUNT, MAX_SEATS, mergeSelection, tweaksOf } from '../../session/lobby';
import type { HostSession } from '../../session/host';
import type { Session } from '../../session/types';
import { avatar, pill, section } from '../components/bits';
import { cardFace } from '../components/card';
import { packBadge, packConsent, removeAddonUpload, removeUpload, uploadProblems, uploadTile } from '../components/packs';
import { countPresets, deleteCountPreset, saveCountPreset } from '../presets';
import { h, type Child } from '../dom';

export interface RoomCtx {
  session: Session;
  /** The same session when this page hosts, for host-only actions like uploads. */
  host: HostSession | null;
  me: Identity;
  /** Built-in packs. */
  packs: LoadedPack[];
  /** The host's last pack upload. */
  upload: { busy: boolean; problems: string[] };
  /** Redraws the room, for changes to local state that no view brings. */
  redraw(): void;
}

/** Whether the lobby uses anything uploaded, which players need before they can see it. */
export function needsFiles(lobby: LobbyView): boolean {
  return Boolean(lobby.customPack) || lobby.customAddons.length > 0;
}

/**
 * The pack the lobby uses, if this page has everything for it: the game (built in, or the
 * custom one once loaded) with any addons that came in their own zips.
 */
export function resolvePack(ctx: RoomCtx, lobby: LobbyView): LoadedPack | undefined {
  // The host has it all, with every uploaded addon for the game, on or off.
  if (ctx.session.isHost) return ctx.session.availablePacks().find((p) => p.key === lobby.packId);
  const state = ctx.session.state();
  const base = lobby.customPack
    ? state.customPack?.custom?.offer.hash === lobby.customPack.hash
      ? state.customPack
      : undefined
    : ctx.packs.find((p) => p.key === lobby.packId);
  if (!base) return undefined;
  const addons = lobby.customAddons.map((o) => state.customAddons.find((a) => a.custom.offer.hash === o.hash));
  if (addons.some((a) => !a)) return undefined;
  return withUploads(base, addons as LoadedAddon[]);
}

export function lobbyMain(ctx: RoomCtx, lobby: LobbyView): Child[] {
  const lp = resolvePack(ctx, lobby);
  return [
    ctx.session.isHost ? gallery(ctx, lobby) : null,
    lp
      ? gameDetail(ctx, lobby, lp)
      : needsFiles(lobby)
        ? packConsent(ctx, lobby)
        : h(
          'section',
          { class: 'panel waiting' },
          h('h2', null, lobby.packId ? 'Unknown game' : 'No game picked yet'),
          h('p', { class: 'muted' }, lobby.packId ? 'The host picked a game this page does not have.' : 'The host is choosing a game.'),
        ),
  ];
}

function gallery(ctx: RoomCtx, lobby: LobbyView): HTMLElement {
  const tiles = ctx.session.availablePacks().map((p) => {
    const tile = h(
      'button',
      {
        type: 'button',
        class: 'tile',
        'aria-pressed': String(p.key === lobby.packId),
        onclick: () => ctx.session.act({ kind: 'selectPack', packId: p.key }),
      },
      h('img', { class: 'tile-img', src: p.asset(p.pack.art.cover), alt: '' }),
      h(
        'span',
        { class: 'tile-body' },
        h('span', { class: 'tile-name' }, p.pack.name),
        h('span', { class: 'tile-meta' }, `${p.pack.players.min} to ${p.pack.players.max} players`, p.custom ? ' · Custom' : ''),
      ),
    );
    if (!p.custom || p.key === lobby.packId) return tile;
    return h(
      'div',
      { class: 'tile-wrap' },
      tile,
      h('button', { type: 'button', class: 'btn btn-xs tile-remove', title: `Remove ${p.pack.name} from this browser`, onclick: () => removeUpload(ctx, p) }, 'Remove'),
    );
  });
  return h(
    'section',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Choose a game')),
    h('div', { class: 'gallery' }, tiles, uploadTile(ctx)),
    uploadProblems(ctx),
  );
}

function seatedCount(lobby: LobbyView): number {
  return lobby.players.filter((p) => p.role === 'player').length;
}

function safeCount(count: Count, players: number): number | null {
  try {
    return resolveCount(count, players);
  } catch {
    return null;
  }
}

function describeCount(count: Count): string {
  if (typeof count === 'number') return String(count);
  if ('perPlayer' in count) return `${count.perPlayer} per player${count.offset ? `, ${count.offset > 0 ? 'plus' : 'minus'} ${Math.abs(count.offset)}` : ''}`;
  return Object.entries(count.byPlayers)
    .map(([players, value]) => `${value} with ${players}`)
    .join(', ');
}

/**
 * The cards of the game, with how many copies go into the deck. The host changes the copies of
 * cards with a fixed count. Counts that depend on the players stay as the pack says.
 */
function cardStrip(ctx: RoomCtx, lobby: LobbyView, lp: LoadedPack, shown: Pack, players: number): Child[] {
  const editable = ctx.session.isHost;
  const changed = Object.keys(lobby.counts).length > 0;
  const origins = cardOrigins(lp.pack, lp.addons, lobby.addons);
  const cards = [...shown.cards]
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .map((c) => {
      const n = safeCount(c.count, players);
      const face = cardFace(lp, c, { origin: origins.get(c.id) });
      const cls = `count-card${n === 0 ? ' is-zero' : ''}${lobby.counts[c.id] !== undefined ? ' is-changed' : ''}`;
      if (!editable || typeof c.count !== 'number' || n === null) return h('div', { class: cls }, face, h('span', { class: 'count-label' }, n === 0 ? 'None' : `x${n ?? '?'}`));
      const set = (count: number) => ctx.session.act({ kind: 'setCardCount', cardId: c.id, count });
      return h(
        'div',
        { class: cls },
        face,
        h(
          'div',
          { class: 'stepper', role: 'group', 'aria-label': `Copies of ${c.name}` },
          h('button', { type: 'button', class: 'btn btn-xs', 'aria-label': `One ${c.name} less`, disabled: n <= 0, onclick: () => set(n - 1) }, '-'),
          h('span', { class: 'stepper-value' }, n),
          h('button', { type: 'button', class: 'btn btn-xs', 'aria-label': `One ${c.name} more`, disabled: n >= MAX_CARD_COUNT, onclick: () => set(n + 1) }, '+'),
        ),
      );
    });
  const note = !changed
    ? editable
      ? h('p', { class: 'muted small' }, 'Use - and + to change how many copies go into the deck.')
      : null
    : h(
        'p',
        { class: 'count-note' },
        editable ? 'You changed how many copies go into the deck.' : 'The host changed how many copies go into the deck.',
        editable ? h('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => ctx.session.act({ kind: 'resetCardCounts' }) }, 'Reset') : null,
      );
  return [h('div', { class: 'card-strip', 'data-keep-scroll': 'cards' }, cards), note, editable ? presetsRow(ctx, lobby, lp) : null];
}

/** The preset name being typed, so a redraw does not clear it. */
let presetName = '';

/** Card count presets the host keeps in this browser: load or delete one, or save the counts now. */
function presetsRow(ctx: RoomCtx, lobby: LobbyView, lp: LoadedPack): HTMLElement {
  const gameId = lp.pack.id;
  const presets = countPresets(gameId);
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  const save = (e: Event) => {
    e.preventDefault();
    const name = presetName.trim();
    if (!name) return;
    saveCountPreset(gameId, name, lobby.counts);
    presetName = '';
    ctx.redraw();
  };
  return h(
    'div',
    { class: 'presets' },
    h('span', { class: 'presets-label' }, 'Presets'),
    names.map((name) =>
      h(
        'span',
        { class: 'preset' },
        h('button', { type: 'button', class: 'btn btn-xs', title: `Load ${name}`, onclick: () => ctx.session.act({ kind: 'setCardCounts', counts: presets[name]! }) }, name),
        h('button', { type: 'button', class: 'btn btn-ghost btn-xs', 'aria-label': `Delete preset ${name}`, title: 'Delete', onclick: () => (deleteCountPreset(gameId, name), ctx.redraw()) }, 'x'),
      ),
    ),
    h(
      'form',
      { class: 'preset-save', onsubmit: save },
      h('input', {
        class: 'input input-sm',
        placeholder: 'Preset name',
        'aria-label': 'Preset name',
        maxlength: 40,
        value: presetName,
        oninput: (e: Event) => (presetName = (e.target as HTMLInputElement).value),
      }),
      h('button', { type: 'submit', class: 'btn btn-xs' }, 'Save counts'),
    ),
  );
}

/** How many seats the table has. The host may go below or above the game's own maximum. */
function seatsControl(ctx: RoomCtx, lobby: LobbyView, base: Pack, editable: boolean): HTMLElement {
  const max = base.players.max;
  const current = lobby.seats ?? max;
  const values: number[] = [];
  for (let n = base.players.min; n <= Math.max(MAX_SEATS, max); n++) values.push(n);
  const label = (n: number) => (n === max ? `${n} (the game's maximum)` : n > max ? `${n} (more than the game is made for)` : String(n));
  return h(
    'select',
    {
      class: 'input',
      disabled: !editable,
      onchange: (e: Event) => {
        const n = Number((e.target as HTMLSelectElement).value);
        ctx.session.act({ kind: 'setSeats', seats: n === max ? null : n });
      },
    },
    values.map((n) => h('option', { value: n, selected: n === current }, label(n))),
  );
}

function gameDetail(ctx: RoomCtx, lobby: LobbyView, lp: LoadedPack): HTMLElement {
  const editable = ctx.session.isHost;
  const { pack, problems } = mergeSelection(lp, lobby.addons, tweaksOf(lobby));
  const shown = pack ?? lp.pack;
  // Preview counts for the lobby size, clamped to what the pack allows.
  const players = Math.min(shown.players.max, Math.max(shown.players.min, seatedCount(lobby)));
  const deck = shown.cards.reduce((sum, c) => sum + (safeCount(c.count, players) ?? 0), 0);

  const addons = lp.addons
    .filter((a) => editable || lobby.addons.includes(a.id))
    .map((a) => {
      const on = lobby.addons.includes(a.id);
      const next = on ? lobby.addons.filter((id) => id !== a.id) : [...lobby.addons, a.id];
      const reason = editable ? addonProblems(lp.addons, next)[0] : undefined;
      const upload = lp.uploads?.find((u) => u.addon === a);
      const tags = [
        a.players?.max ? pill(`Up to ${a.players.max} players`) : null,
        upload ? pill(upload.custom.offer.author ? `Uploaded, by ${upload.custom.offer.author}` : 'Uploaded') : null,
      ].filter(Boolean);
      return h(
        'label',
        { class: `addon${on ? ' is-on' : ''}` },
        a.image ? h('img', { class: 'addon-img', src: lp.asset(a.image), alt: '' }) : h('span', { class: 'addon-img' }),
        h(
          'span',
          { class: 'addon-text' },
          h('span', { class: 'addon-name' }, a.name),
          h('span', { class: 'addon-desc' }, a.description),
          tags.length ? h('span', { class: 'addon-tags' }, tags) : null,
          reason ? h('span', { class: 'addon-warn' }, reason) : null,
          upload && editable && !on
            ? h('button', { type: 'button', class: 'btn btn-xs addon-remove', onclick: (e: Event) => (e.preventDefault(), removeAddonUpload(ctx, upload)) }, 'Remove')
            : null,
        ),
        editable
          ? h('input', {
              type: 'checkbox',
              class: 'switch',
              checked: on,
              disabled: Boolean(reason),
              'aria-label': `Use ${a.name}`,
              onchange: (e: Event) =>
                ctx.session.act({ kind: 'toggleAddon', addonId: a.id, on: (e.target as HTMLInputElement).checked }),
            })
          : pill('On'),
      );
    });

  const base = mergeSelection(lp, lobby.addons).pack ?? lp.pack;
  const seats = h('label', { class: 'option' }, h('span', { class: 'option-label' }, 'Seats'), seatsControl(ctx, lobby, base, editable));
  const seatsNote =
    lobby.seats !== null && lobby.seats > base.players.max
      ? h('p', { class: 'muted small' }, `More seats than the game is made for. Counts that depend on the players stay as they are for ${base.players.max}. Add copies above if the deck runs short.`)
      : null;
  const options = (shown.options ?? []).map((def) =>
    h(
      'label',
      { class: 'option' },
      h('span', { class: 'option-label' }, def.label),
      optionControl(def, lobby.options[def.id], editable, (value) => ctx.session.act({ kind: 'setOption', id: def.id, value })),
    ),
  );

  const blocked = lobby.startBlocked;
  return h(
    'section',
    { class: 'panel detail' },
    h(
      'div',
      { class: 'hero' },
      h('img', { class: 'hero-img', src: lp.asset(lp.pack.art.cover), alt: '' }),
      h(
        'div',
        { class: 'hero-text' },
        h('h2', null, shown.name),
        h(
          'div',
          { class: 'hero-pills' },
          pill(`${shown.players.min} to ${shown.players.max} players`),
          pill(`${deck} cards`),
          pill(`v${shown.version}`),
        ),
      ),
    ),
    h('p', { class: 'detail-desc' }, shown.description),
    shown.author ? h('p', { class: 'muted small' }, `By ${shown.author}`) : null,
    problems.length && !editable ? h('p', { class: 'form-error' }, problems[0]) : null,
    section('Cards', cardStrip(ctx, lobby, lp, shown, players)),
    addons.length ? section('Addons', h('div', { class: 'addons' }, addons)) : null,
    section('Options', h('div', { class: 'options' }, seats, options), seatsNote),
    h(
      'div',
      { class: 'start-row' },
      editable
        ? h('p', { class: `start-reason${blocked ? '' : ' ok'}` }, blocked ?? 'Everyone is ready.')
        : h('p', { class: 'start-reason' }, blocked ? `Not ready yet: ${blocked}` : 'Waiting for the host to start.'),
      editable
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-primary btn-lg',
              disabled: Boolean(blocked),
              onclick: () => ctx.session.act({ kind: 'start' }),
            },
            'Start game',
          )
        : null,
    ),
  );
}

function optionControl(
  def: OptionDef,
  value: OptionValue | undefined,
  editable: boolean,
  onChange: (v: OptionValue) => void,
): HTMLElement {
  const change = (e: Event) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') onChange(el.checked);
    else if (def.type === 'number') onChange(el.value === AUTO ? AUTO : Number(el.value));
    else onChange(el.value);
  };
  const disabled = !editable;
  switch (def.type) {
    case 'select': {
      const current = value ?? def.default;
      return h(
        'select',
        { class: 'input', onchange: change, disabled },
        def.choices.map((c) => h('option', { value: c.value, selected: c.value === current }, c.label)),
      );
    }
    case 'number': {
      const current = value ?? (typeof def.default === 'number' ? def.default : AUTO);
      const values: number[] = [];
      for (let n = def.min ?? 1; n <= (def.max ?? 10); n++) values.push(n);
      return h(
        'select',
        { class: 'input', onchange: change, disabled },
        typeof def.default === 'number'
          ? null
          : h('option', { value: AUTO, selected: current === AUTO }, `Auto (${describeCount(def.default)})`),
        values.map((n) => h('option', { value: n, selected: current === n }, String(n))),
      );
    }
    case 'toggle':
      return h('input', { type: 'checkbox', class: 'switch', checked: Boolean(value ?? def.default), onchange: change, disabled });
  }
}

export function playersPanel(ctx: RoomCtx, lobby: LobbyView, game: GameView | null = null): HTMLElement {
  const lp = resolvePack(ctx, lobby);
  const max = lp ? (mergeSelection(lp, lobby.addons, tweaksOf(lobby)).pack ?? lp.pack).players.max : undefined;
  const isHost = ctx.session.isHost;
  // Watchers who could take over an away player's seat.
  const watchers = lobby.players.filter((p) => p.role === 'spectator' && p.connected);
  const rows = lobby.players.map((p) => {
    const seat = game?.players.find((s) => s.playerId === p.playerId);
    const button = (label: string, title: string, onclick: () => void) =>
      h('button', { type: 'button', class: 'btn btn-ghost btn-xs', title, onclick }, label);
    let actions: Child = null;
    if (isHost && !p.isHost) {
      if (!game && !p.connected) {
        actions = button('Remove', `Remove ${p.name} from the lobby`, () => ctx.session.act({ kind: 'removePlayer', playerId: p.playerId }));
      } else if (game && seat?.round === 'in' && game.phase === 'round') {
        actions = button('Take out', `Take ${p.name} out of this round. They keep their seat and tokens.`, () =>
          ctx.session.act({ kind: 'kickForRound', playerId: p.playerId }),
        );
      }
    }
    const handOver =
      isHost && game && seat && !p.connected && watchers.length
        ? h(
            'select',
            {
              class: 'input input-xs',
              'aria-label': `Give ${p.name}'s seat to`,
              onchange: (e: Event) => {
                const to = (e.target as HTMLSelectElement).value;
                if (to) ctx.session.act({ kind: 'assignSeat', seatOf: p.playerId, to });
              },
            },
            h('option', { value: '' }, 'Give seat to...'),
            watchers.map((w) => h('option', { value: w.playerId }, w.name)),
          )
        : null;
    return h(
      'li',
      { class: `player${p.connected ? '' : ' is-away'}` },
      avatar(p.name, p.color),
      h('span', { class: 'player-name' }, p.name),
      p.isHost ? h('span', { class: 'badge' }, 'Host') : null,
      p.playerId === ctx.me.playerId ? h('span', { class: 'badge badge-soft' }, 'You') : null,
      p.role === 'spectator' ? h('span', { class: 'badge badge-soft' }, 'Watching') : null,
      lobby.customPack ? packBadge(p.pack) : null,
      actions,
      handOver,
      h('span', { class: `conn${p.connected ? ' on' : ''}`, title: p.connected ? 'Connected' : 'Away' }),
    );
  });
  return h(
    'section',
    { class: 'panel players' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Players'), max && !game ? pill(`${seatedCount(lobby)} / ${max}`) : null),
    h('ul', { class: 'player-list' }, rows),
    h('p', { class: 'muted small' }, game ? 'People who join now watch until the next game.' : 'Share the link or code to invite friends.'),
  );
}

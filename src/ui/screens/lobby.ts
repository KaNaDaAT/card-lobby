/**
 * The lobby, drawn from the latest view. The host gets the gallery and live controls, everyone
 * else sees the same game, addons and options read-only.
 */
import type { GameView } from '../../engine/types';
import type { Identity } from '../../identity';
import type { LobbyView } from '../../net/protocol';
import { resolveCount } from '../../packs/count';
import { addonProblems } from '../../packs/merge';
import type { Count, LoadedPack, OptionDef, OptionValue } from '../../packs/types';
import { AUTO, mergeSelection } from '../../session/lobby';
import type { HostSession } from '../../session/host';
import type { Session } from '../../session/types';
import { avatar, pill, section } from '../components/bits';
import { cardFace } from '../components/card';
import { packBadge, packConsent, removeUpload, uploadProblems, uploadTile } from '../components/packs';
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

/** The pack the lobby uses, if this page has it: a built-in one, or the custom pack once loaded. */
export function resolvePack(ctx: RoomCtx, lobby: LobbyView): LoadedPack | undefined {
  if (lobby.customPack) {
    const custom = ctx.session.state().customPack;
    return custom?.custom?.offer.hash === lobby.customPack.hash ? custom : undefined;
  }
  return ctx.packs.find((p) => p.key === lobby.packId);
}

export function lobbyMain(ctx: RoomCtx, lobby: LobbyView): Child[] {
  const lp = resolvePack(ctx, lobby);
  return [
    ctx.session.isHost ? gallery(ctx, lobby) : null,
    lp
      ? gameDetail(ctx, lobby, lp)
      : lobby.customPack
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

function gameDetail(ctx: RoomCtx, lobby: LobbyView, lp: LoadedPack): HTMLElement {
  const editable = ctx.session.isHost;
  const { pack, problems } = mergeSelection(lp, lobby.addons);
  const shown = pack ?? lp.pack;
  // Preview counts for the lobby size, clamped to what the pack allows.
  const players = Math.min(shown.players.max, Math.max(shown.players.min, seatedCount(lobby)));
  const deck = shown.cards.reduce((sum, c) => sum + (safeCount(c.count, players) ?? 0), 0);

  const cards = [...shown.cards]
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .map((c) => cardFace(lp, c, { count: safeCount(c.count, players) ?? undefined }));

  const addons = lp.addons
    .filter((a) => editable || lobby.addons.includes(a.id))
    .map((a) => {
      const on = lobby.addons.includes(a.id);
      const next = on ? lobby.addons.filter((id) => id !== a.id) : [...lobby.addons, a.id];
      const reason = editable ? addonProblems(lp.addons, next)[0] : undefined;
      return h(
        'label',
        { class: `addon${on ? ' is-on' : ''}` },
        a.image ? h('img', { class: 'addon-img', src: lp.asset(a.image), alt: '' }) : h('span', { class: 'addon-img' }),
        h(
          'span',
          { class: 'addon-text' },
          h('span', { class: 'addon-name' }, a.name),
          h('span', { class: 'addon-desc' }, a.description),
          a.players?.max ? h('span', { class: 'addon-tags' }, pill(`Up to ${a.players.max} players`)) : null,
          reason ? h('span', { class: 'addon-warn' }, reason) : null,
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
    section('Cards', h('div', { class: 'card-strip' }, cards)),
    addons.length ? section('Addons', h('div', { class: 'addons' }, addons)) : null,
    options.length ? section('Options', h('div', { class: 'options' }, options)) : null,
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
  const max = lp ? (mergeSelection(lp, lobby.addons).pack ?? lp.pack).players.max : undefined;
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

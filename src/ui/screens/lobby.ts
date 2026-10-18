import { isHosting, loadIdentity, safeColor, type Identity } from '../../identity';
import { formatCode } from '../../net/code';
import { CHAT_MAX_LENGTH, type ChatMessage, type LobbyPlayer } from '../../net/protocol';
import { resolveCount } from '../../packs/count';
import { loadBuiltInPacks } from '../../packs/load';
import { addonProblems, mergeAddons } from '../../packs/merge';
import type { Count, LoadedPack, OptionDef, OptionValue, Pack } from '../../packs/types';
import { cardFace } from '../components/card';
import { h, replace, type Child } from '../dom';
import { roomLink, type Screen } from '../router';

/**
 * Lobby screen. Until milestone 1 it runs on local state: the host view works, chat echoes
 * locally, and joiners see a waiting state. `Model` mirrors `LobbyView` so the session can
 * take over later without changing the drawing code.
 */
interface Model {
  code: string;
  me: Identity;
  isHost: boolean;
  packs: LoadedPack[];
  packId: string | null;
  addons: string[];
  options: Record<string, OptionValue>;
  players: LobbyPlayer[];
  chat: ChatMessage[];
}

/** Option value meaning "use the pack's default for the player count at start". */
const AUTO = 'auto';
const DEFAULT_ACCENT = '#9d85ff';

export const renderLobby: Screen<{ name: 'room'; code: string }> = (root, { code }) => {
  const me = loadIdentity();
  const isHost = isHosting(code);
  const model: Model = {
    code,
    me,
    isHost,
    packs: [],
    packId: null,
    addons: [],
    options: {},
    players: isHost
      ? [{ playerId: me.playerId, name: me.name, color: me.color, connected: true, isHost: true, role: 'player', packReady: true }]
      : [],
    chat: [
      {
        id: 'welcome',
        from: 'system',
        name: '',
        text: isHost ? 'Lobby created. Share the link or code to invite friends.' : `Joining room ${formatCode(code)}.`,
        at: Date.now(),
      },
    ],
  };

  const gameRegion = h('section', { class: 'col-main' });
  const playersRegion = h('div');
  const chatLog = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const chatInput = h('input', {
    class: 'input',
    maxlength: CHAT_MAX_LENGTH,
    placeholder: 'Say something',
    'aria-label': 'Chat message',
    autocomplete: 'off',
  });

  const sendChat = (e: Event) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    model.chat.push({ id: crypto.randomUUID(), from: me.playerId, name: me.name, text, at: Date.now() });
    chatInput.value = '';
    drawChat();
  };

  const copyButton = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Copy link');
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      copyButton.textContent = 'Copied';
    } catch {
      copyButton.textContent = 'Copy failed';
    }
    setTimeout(() => (copyButton.textContent = 'Copy link'), 1500);
  });

  const room = h(
    'div',
    { class: 'room' },
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand-small', href: '#/' }, brandMark('sm'), 'Card Lobby'),
      h(
        'div',
        { class: 'room-code' },
        h('span', { class: 'room-code-label' }, 'Room'),
        h('code', null, formatCode(code)),
        copyButton,
      ),
      h('span', { class: 'me-chip' }, avatar(me.name, me.color), h('span', { class: 'me-name' }, me.name)),
    ),
    h(
      'div',
      { class: 'notice' },
      h('strong', null, 'Offline preview.'),
      ' Players, chat and Start connect in milestone 1. Chat only echoes locally for now.',
    ),
    h(
      'main',
      { class: 'room-grid' },
      gameRegion,
      h(
        'aside',
        { class: 'col-side' },
        playersRegion,
        h(
          'section',
          { class: 'panel chat' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Chat')),
          chatLog,
          h('form', { class: 'chat-form', onsubmit: sendChat }, chatInput, h('button', { type: 'submit', class: 'btn' }, 'Send')),
        ),
      ),
    ),
  );
  root.append(room);

  const selectPack = (packId: string) => {
    model.packId = packId;
    model.addons = [];
    model.options = {};
    draw();
  };

  const draw = () => {
    const lp = model.packs.find((p) => p.pack.id === model.packId);
    const merged = lp ? mergeSelection(lp, model.addons) : null;
    const accent = lp?.pack.art.accent;
    room.style.setProperty('--accent', accent && CSS.supports('color', accent) ? accent : DEFAULT_ACCENT);
    replace(
      gameRegion,
      model.isHost ? hostGame(model, lp, merged, { selectPack, redraw: draw }) : waitingForHost(model),
    );
    replace(playersRegion, playersPanel(model, merged?.pack ?? lp?.pack));
  };

  const drawChat = () => {
    replace(
      chatLog,
      model.chat.map((m) => {
        if (m.from === 'system') return h('p', { class: 'msg msg-system' }, m.text);
        const color = model.players.find((p) => p.playerId === m.from)?.color ?? me.color;
        return h(
          'p',
          { class: 'msg' },
          h('span', { class: 'msg-name', style: `--c: ${safeColor(color)}` }, m.name),
          h('span', { class: 'msg-text' }, m.text),
        );
      }),
    );
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  draw();
  drawChat();

  if (model.isHost) {
    loadBuiltInPacks()
      .then((packs) => {
        model.packs = packs;
        if (!model.packId && packs[0]) selectPack(packs[0].pack.id);
        else draw();
      })
      .catch((err: unknown) => {
        replace(gameRegion, h('div', { class: 'panel' }, h('h2', null, 'Could not load games'), h('p', { class: 'form-error' }, String(err))));
      });
  }
};

function brandMark(size?: 'sm'): HTMLElement {
  return h('span', { class: `brand-mark${size ? ` ${size}` : ''}`, 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
}

function avatar(name: string, color: string): HTMLElement {
  return h('span', { class: 'avatar', style: `--c: ${safeColor(color)}`, 'aria-hidden': 'true' }, name.trim().charAt(0).toUpperCase() || '?');
}

function pill(text: string): HTMLElement {
  return h('span', { class: 'pill' }, text);
}

function section(title: string, ...body: Child[]): HTMLElement {
  return h('section', { class: 'detail-section' }, h('h3', null, title), ...body);
}

function playerCount(model: Model): number {
  return model.players.filter((p) => p.role === 'player').length;
}

/** Player count used to preview card counts: the lobby size, clamped to what the pack allows. */
function previewPlayers(model: Model, pack: Pack): number {
  return Math.min(pack.players.max, Math.max(pack.players.min, playerCount(model)));
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

function startBlocked(model: Model, pack: Pack | null, problems: string[]): string | null {
  if (!pack) return 'Pick a game first.';
  if (problems.length) return problems[0]!;
  const n = playerCount(model);
  if (n < pack.players.min) return `Needs at least ${pack.players.min} players, ${n} here.`;
  if (n > pack.players.max) return `${pack.players.max} players at most, ${n} here.`;
  if (model.players.some((p) => p.role === 'player' && !p.packReady)) return 'Waiting for everyone to get the pack.';
  return null;
}

/** The pack with the selected addons applied. `pack` is null when merging failed. */
function mergeSelection(lp: LoadedPack, addons: string[]): { pack: Pack | null; problems: string[] } {
  const problems = addonProblems(lp.addons, addons);
  try {
    return { pack: mergeAddons(lp.pack, lp.addons, addons), problems };
  } catch (err) {
    return { pack: null, problems: [err instanceof Error ? err.message : String(err), ...problems] };
  }
}

function hostGame(
  model: Model,
  lp: LoadedPack | undefined,
  merged: { pack: Pack | null; problems: string[] } | null,
  actions: { selectPack(id: string): void; redraw(): void },
): Child[] {
  const gallery = h(
    'section',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Choose a game')),
    h(
      'div',
      { class: 'gallery' },
      model.packs.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'tile',
            'aria-pressed': String(p.pack.id === model.packId),
            onclick: () => actions.selectPack(p.pack.id),
          },
          h('img', { class: 'tile-img', src: p.asset(p.pack.art.cover), alt: '' }),
          h(
            'span',
            { class: 'tile-body' },
            h('span', { class: 'tile-name' }, p.pack.name),
            h('span', { class: 'tile-meta' }, `${p.pack.players.min} to ${p.pack.players.max} players`),
          ),
        ),
      ),
      h(
        'div',
        { class: 'tile tile-custom', 'aria-disabled': 'true' },
        h('span', { class: 'tile-img tile-plus', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'tile-body' },
          h('span', { class: 'tile-name' }, 'Custom pack'),
          h('span', { class: 'tile-meta' }, 'Upload a .zip (milestone 5)'),
        ),
      ),
    ),
  );
  if (!lp || !merged) {
    return [gallery, model.packs.length ? null : h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'Loading games...'))];
  }

  const { pack, problems } = merged;
  const shown = pack ?? lp.pack;
  const players = previewPlayers(model, shown);
  const deck = shown.cards.reduce((sum, c) => sum + (safeCount(c.count, players) ?? 0), 0);
  const blocked = startBlocked(model, pack, problems);

  const cards = [...shown.cards]
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .map((c) => cardFace(lp, c, { count: safeCount(c.count, players) ?? undefined }));

  const addons = lp.addons.map((a) => {
    const on = model.addons.includes(a.id);
    const next = on ? model.addons.filter((id) => id !== a.id) : [...model.addons, a.id];
    const reason = addonProblems(lp.addons, next)[0];
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
      h('input', {
        type: 'checkbox',
        class: 'switch',
        checked: on,
        disabled: Boolean(reason),
        'aria-label': `Use ${a.name}`,
        onchange: (e: Event) => {
          const checked = (e.target as HTMLInputElement).checked;
          model.addons = checked ? [...model.addons, a.id] : model.addons.filter((id) => id !== a.id);
          actions.redraw();
        },
      }),
    );
  });

  const options = (shown.options ?? []).map((def) =>
    h(
      'label',
      { class: 'option' },
      h('span', { class: 'option-label' }, def.label),
      optionControl(def, model.options[def.id], (value) => {
        model.options[def.id] = value;
        actions.redraw();
      }),
    ),
  );

  const detail = h(
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
    section('Cards', h('div', { class: 'card-strip' }, cards)),
    addons.length ? section('Addons', h('div', { class: 'addons' }, addons)) : null,
    options.length ? section('Options', h('div', { class: 'options' }, options)) : null,
    h(
      'div',
      { class: 'start-row' },
      h('p', { class: `start-reason${blocked ? '' : ' ok'}` }, blocked ?? 'Everyone is ready.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: Boolean(blocked) }, 'Start game'),
    ),
  );
  return [gallery, detail];
}

function optionControl(def: OptionDef, value: OptionValue | undefined, onChange: (v: OptionValue) => void): HTMLElement {
  const change = (e: Event) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') onChange(el.checked);
    else if (def.type === 'number') onChange(el.value === AUTO ? AUTO : Number(el.value));
    else onChange(el.value);
  };
  switch (def.type) {
    case 'select': {
      const current = value ?? def.default;
      return h(
        'select',
        { class: 'input', onchange: change },
        def.choices.map((c) => h('option', { value: c.value, selected: c.value === current }, c.label)),
      );
    }
    case 'number': {
      const current = value ?? (typeof def.default === 'number' ? def.default : AUTO);
      const values: number[] = [];
      for (let n = def.min ?? 1; n <= (def.max ?? 10); n++) values.push(n);
      return h(
        'select',
        { class: 'input', onchange: change },
        typeof def.default === 'number'
          ? null
          : h('option', { value: AUTO, selected: current === AUTO }, `Auto (${describeCount(def.default)})`),
        values.map((n) => h('option', { value: n, selected: current === n }, String(n))),
      );
    }
    case 'toggle':
      return h('input', { type: 'checkbox', class: 'switch', checked: Boolean(value ?? def.default), onchange: change });
  }
}

function waitingForHost(model: Model): Child {
  return h(
    'section',
    { class: 'panel waiting' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('h2', null, 'Looking for the host'),
    h('p', { class: 'muted' }, `Room ${formatCode(model.code)}. The game the host picks will show up here.`),
    h(
      'p',
      { class: 'muted small' },
      'Networking arrives in milestone 1. To see the host view, create a lobby from the home screen.',
    ),
  );
}

function playersPanel(model: Model, pack: Pack | undefined): HTMLElement {
  const max = pack?.players.max;
  const rows = model.players.map((p) =>
    h(
      'li',
      { class: 'player' },
      avatar(p.name, p.color),
      h('span', { class: 'player-name' }, p.name),
      p.isHost ? h('span', { class: 'badge' }, 'Host') : null,
      p.playerId === model.me.playerId ? h('span', { class: 'badge badge-soft' }, 'You') : null,
      h('span', { class: `conn${p.connected ? ' on' : ''}`, title: p.connected ? 'Connected' : 'Away' }),
    ),
  );
  if (!model.isHost) {
    rows.push(
      h(
        'li',
        { class: 'player' },
        avatar(model.me.name, model.me.color),
        h('span', { class: 'player-name' }, model.me.name),
        h('span', { class: 'badge badge-soft' }, 'You'),
        h('span', { class: 'conn', title: 'Connecting' }),
      ),
    );
  }
  return h(
    'section',
    { class: 'panel players' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', null, 'Players'),
      max ? pill(`${playerCount(model)} / ${max}`) : null,
    ),
    h('ul', { class: 'player-list' }, rows),
    h('p', { class: 'muted small' }, 'Share the link or code to invite friends.'),
  );
}

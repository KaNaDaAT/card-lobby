/**
 * A room: opens the transport, becomes host or client, and draws the lobby or the table from
 * the session's latest view. Chat sits beside both.
 */
import { isHosting, loadChatCleared, loadIdentity, loadRoomSnapshot, safeColor, saveChatCleared, saveRoomSnapshot } from '../../identity';
import { formatCode } from '../../net/code';
import { joinLocalRoom } from '../../net/local';
import { CHAT_COOLDOWNS, CHAT_MAX_LENGTH, type ChatMessage, type View } from '../../net/protocol';
import type { Transport } from '../../net/transport';
import { loadBuiltInPacks } from '../../packs/load';
import { browserPackLoader, loadCachedPacks } from '../../packs/loader';
import { ClientSession } from '../../session/client';
import { HostSession } from '../../session/host';
import type { Session, SessionState } from '../../session/types';
import { avatar, brandMark, pill } from '../components/bits';
import { confirmDialog } from '../components/dialog';
import { h, replace, type Child } from '../dom';
import { roomLink, type Screen } from '../router';
import { packConsent } from '../components/packs';
import { lobbyMain, needsFiles, playersPanel, resolvePack, type RoomCtx } from './lobby';
import { logPanel, newTableMemo, tableLayout, tableMain, type TableMemo } from './table';

const DEFAULT_ACCENT = '#9d85ff';

export function useLocalTransport(): boolean {
  return new URLSearchParams(location.search).get('transport') === 'local';
}

async function openTransport(code: string, local: boolean): Promise<Transport> {
  if (local) return joinLocalRoom(code);
  // Loaded on demand, so local mode and the home screen never pull in WebRTC code.
  const { joinTrysteroRoom } = await import('../../net/trystero');
  return joinTrysteroRoom(code);
}

export const renderRoom: Screen<{ name: 'room'; code: string }> = (root, { code }) => {
  const me = loadIdentity();
  const local = useLocalTransport();
  let ctx: RoomCtx | null = null;
  let disposed = false;
  let drawnChat: ChatMessage[] | null = null;
  let memo: TableMemo = newTableMemo();
  // Phone layout: the side column becomes a drawer, opened from a dock at the bottom.
  const narrow = matchMedia('(max-width: 960px)');
  let drawer: 'side' | 'chat' | null = null;
  let sideLabel = 'Players';
  let unread = 0;
  // The round table keeps the players list in a tab beside the log, out of the way.
  let sideTab: 'log' | 'players' = 'log';

  const banner = h('div', { class: 'banner-slot' });
  const mainRegion = h('section', { class: 'col-main' });
  const sideRegion = h('div', { class: 'col-side-top' });
  const chatLog = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const chatInput = h('input', {
    class: 'input',
    maxlength: CHAT_MAX_LENGTH,
    placeholder: 'Say something',
    'aria-label': 'Chat message',
    autocomplete: 'off',
  });
  const chatSend = h('button', { type: 'submit', class: 'btn' }, 'Send');
  const chatTools = h('div', { class: 'chat-tools' });
  // Messages up to this one are cleared from this screen only.
  let chatHiddenUpTo = loadChatCleared(code);

  // Slow mode: Send waits out the host's cooldown after each message. The host is exempt.
  let lastSent = 0;
  let sendTick: ReturnType<typeof setTimeout> | undefined;
  const sendWait = () => {
    const seconds = ctx && !ctx.session.isHost ? (ctx.session.state().view?.lobby.chatCooldown ?? 0) : 0;
    return Math.max(0, lastSent + seconds * 1000 - Date.now());
  };
  const updateSend = () => {
    clearTimeout(sendTick);
    const canTalk = Boolean(ctx && (ctx.session.isHost || ctx.session.state().status === 'connected'));
    const wait = sendWait();
    chatInput.disabled = !canTalk;
    chatSend.disabled = !canTalk || wait > 0;
    chatSend.textContent = wait > 0 ? `Wait ${Math.ceil(wait / 1000)}s` : 'Send';
    if (wait > 0) sendTick = setTimeout(updateSend, wait % 1000 || 1000);
  };

  const sendChat = (e: Event) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ctx || sendWait() > 0) return;
    ctx.session.say(text);
    chatInput.value = '';
    lastSent = Date.now();
    updateSend();
  };

  const sideButton = h('button', { type: 'button', class: 'btn dock-btn', onclick: () => openDrawer('side') });
  const chatButton = h('button', { type: 'button', class: 'btn dock-btn', onclick: () => openDrawer('chat') });
  const drawerTitle = h('h2', null);
  const updateDock = () => {
    sideButton.textContent = sideLabel;
    replace(chatButton, 'Chat', unread ? h('span', { class: 'dock-badge', 'aria-label': `${unread} new` }, unread) : null);
    drawerTitle.textContent = drawer === 'chat' ? 'Chat' : sideLabel;
  };
  const openDrawer = (which: 'side' | 'chat' | null) => {
    drawer = which;
    if (which) room.dataset.drawer = which;
    else delete room.dataset.drawer;
    if (which === 'chat') {
      unread = 0;
      chatLog.scrollTop = chatLog.scrollHeight;
    }
    updateDock();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drawer) openDrawer(null);
  };
  document.addEventListener('keydown', onKey);

  const copyButton = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Copy link');
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code, { local }));
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
      local ? pill('Local mode', 'pill-warn') : null,
      h(
        'div',
        { class: 'room-code' },
        h('span', { class: 'room-code-label' }, 'Room'),
        h('code', null, formatCode(code)),
        copyButton,
      ),
      h('span', { class: 'me-chip' }, avatar(me.name, me.color), h('span', { class: 'me-name' }, me.name)),
    ),
    banner,
    h(
      'main',
      { class: 'room-grid' },
      mainRegion,
      h('div', { class: 'drawer-backdrop', onclick: () => openDrawer(null) }),
      h(
        'aside',
        { class: 'col-side' },
        h(
          'div',
          { class: 'drawer-head' },
          drawerTitle,
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openDrawer(null) }, 'Close'),
        ),
        sideRegion,
        h(
          'section',
          { class: 'panel chat' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Chat'), chatTools),
          chatLog,
          h('form', { class: 'chat-form', onsubmit: sendChat }, chatInput, chatSend),
        ),
      ),
    ),
    h('nav', { class: 'dock', 'aria-label': 'Panels' }, sideButton, chatButton),
  );
  root.append(room);
  updateDock();
  replace(mainRegion, waitingPanel('Connecting', local ? 'Opening a local room for tabs in this browser.' : 'Joining the room.'));

  const draw = () => {
    if (!ctx) return;
    const state = ctx.session.state();
    const view = state.view;
    const lp = view ? resolvePack(ctx, view.lobby) : undefined;
    const accent = lp?.pack.art.accent;
    room.style.setProperty('--accent', accent && CSS.supports('color', accent) ? accent : DEFAULT_ACCENT);

    updateSend();
    const slow = chatTools.querySelector('select');
    if (slow && view) slow.value = String(view.lobby.chatCooldown);

    replace(banner, statusBanner(state));
    if (state.status === 'outdated') {
      replace(mainRegion, waitingPanel('Update needed', 'This room runs a different version of Card Lobby. Reload the page to update.', false));
      replace(sideRegion);
    } else if (!view) {
      replace(
        mainRegion,
        waitingPanel(
          'Looking for the host',
          `Room ${formatCode(code)}. The host needs to have the room open.`,
          true,
          local ? 'Local mode only reaches other tabs of this browser.' : null,
        ),
      );
      replace(sideRegion);
    } else {
      // Views come from the host. One that cannot be drawn must not freeze the page.
      try {
        drawView(ctx, view);
      } catch (err) {
        console.error(err);
        replace(mainRegion, waitingPanel('Could not draw this view', String(err), false));
      }
    }
    if (state.chat !== drawnChat) drawChat(ctx, state, view);
  };

  const drawView = (c: RoomCtx, view: View) => {
    if (view.game && view.lobby.phase === 'playing') {
      // Someone who joined a custom game late needs its files before they can watch.
      const table = needsFiles(view.lobby) && !resolvePack(c, view.lobby) ? [packConsent(c, view.lobby)] : tableMain(c, view.lobby, view.game, memo);
      const players = playersPanel(c, view.lobby, view.game);
      const log = logPanel(view.game);
      if (tableLayout() === 'round') {
        const tab = (id: typeof sideTab, label: string) =>
          h('button', { type: 'button', class: `seg${sideTab === id ? ' is-on' : ''}`, 'aria-pressed': String(sideTab === id), onclick: () => ((sideTab = id), draw()) }, label);
        replace(mainRegion, table);
        replace(sideRegion, h('div', { class: 'side-tabs layout-toggle', role: 'group', 'aria-label': 'Side panel' }, tab('log', 'Log'), tab('players', 'Players')), sideTab === 'log' ? log : players);
        sideLabel = 'Log and players';
      } else {
        replace(mainRegion, table, players);
        replace(sideRegion, log);
        sideLabel = 'Log';
      }
      const lines = log.querySelector('.log');
      if (lines) lines.scrollTop = lines.scrollHeight;
    } else {
      memo = newTableMemo();
      replace(mainRegion, lobbyMain(c, view.lobby));
      replace(sideRegion, playersPanel(c, view.lobby));
      sideLabel = 'Players';
    }
    updateDock();
  };

  const drawChat = (c: RoomCtx, state: SessionState, view: View | null) => {
    // Count what others said while the chat drawer was closed.
    if (narrow.matches && drawer !== 'chat' && drawnChat) {
      const seen = new Set(drawnChat.map((m) => m.id));
      unread += state.chat.filter((m) => !seen.has(m.id) && m.from !== 'system' && m.from !== c.me.playerId).length;
      updateDock();
    }
    drawnChat = state.chat;
    const colors = new Map(view?.lobby.players.map((p) => [p.playerId, p.color]));
    const stick = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
    // A cleared message that is gone (the host cleared the chat) shows everything again.
    const cut = state.chat.findIndex((m) => m.id === chatHiddenUpTo) + 1;
    const shown = state.chat.slice(cut);
    replace(
      chatLog,
      cut && !shown.length ? h('p', { class: 'msg msg-system' }, 'You cleared the chat.') : null,
      shown.map((m) => {
        if (m.from === 'system') return h('p', { class: 'msg msg-system' }, m.text);
        const color = colors.get(m.from) ?? (m.from === c.me.playerId ? c.me.color : '#857c98');
        return h(
          'p',
          { class: 'msg' },
          h('span', { class: 'msg-name', style: `--c: ${safeColor(color)}` }, m.name),
          h('span', { class: 'msg-text' }, m.text),
        );
      }),
    );
    if (stick) chatLog.scrollTop = chatLog.scrollHeight;
  };

  /** The host clears the chat for everyone and sets slow mode. Players clear their own screen. */
  const fillChatTools = (c: RoomCtx) => {
    if (!c.session.isHost) {
      const clear = () => {
        const last = c.session.state().chat.at(-1);
        if (!last) return;
        chatHiddenUpTo = last.id;
        saveChatCleared(code, last.id);
        drawnChat = null;
        draw();
      };
      replace(chatTools, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Clears the chat on your screen', onclick: clear }, 'Clear'));
      return;
    }
    const slow = h(
      'select',
      {
        class: 'input input-sm',
        'aria-label': 'Slow mode',
        title: 'Slow mode: how long players wait between messages',
        onchange: (e: Event) => c.session.act({ kind: 'setChatCooldown', seconds: Number((e.target as HTMLSelectElement).value) }),
      },
      CHAT_COOLDOWNS.map((s) => h('option', { value: String(s) }, s ? `Slow: ${s}s` : 'Slow mode off')),
    );
    const clear = async () => {
      if (await confirmDialog('Clear the chat?', 'This clears the chat for everyone in the room.', 'Clear chat', 'Keep it')) c.session.act({ kind: 'clearChat' });
    };
    replace(chatTools, slow, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Clears the chat for everyone', onclick: () => void clear() }, 'Clear'));
  };

  void (async () => {
    try {
      const hosting = isHosting(code);
      const packs = await loadBuiltInPacks();
      // The host's gallery also shows the custom games and addons this browser has.
      const custom = hosting ? await loadCachedPacks() : [];
      const customGames = custom.flatMap((c) => (c.kind === 'game' ? [c.pack] : []));
      const customAddons = custom.flatMap((c) => (c.kind === 'addon' ? [c.addon] : []));
      if (disposed) return;
      // The session must exist before any network event runs, or it misses peer joins.
      const transport = await openTransport(code, local);
      if (disposed) {
        transport.leave();
        return;
      }
      const host = hosting
        ? new HostSession({
            code,
            me,
            transport,
            packs: [...packs, ...customGames],
            addons: customAddons,
            store: { load: () => loadRoomSnapshot(code), save: (data) => saveRoomSnapshot(code, data) },
          })
        : null;
      const session: Session = host ?? new ClientSession({ code, me, transport, packs: browserPackLoader });
      ctx = { session, host, me, packs, upload: { busy: false, problems: [] }, redraw: draw };
      fillChatTools(ctx);
      session.subscribe(draw);
      draw();
    } catch (err) {
      if (!disposed) replace(mainRegion, waitingPanel('Something went wrong', String(err), false));
    }
  })();

  return () => {
    disposed = true;
    clearTimeout(sendTick);
    document.removeEventListener('keydown', onKey);
    ctx?.session.leave();
  };
};

function statusBanner(state: SessionState): Child {
  if (state.status === 'hostAway') {
    return h(
      'div',
      { class: 'notice notice-warn', role: 'status' },
      h('strong', null, 'The host is away.'),
      ' Everything continues when they are back.',
    );
  }
  return null;
}

function waitingPanel(title: string, text: string, spin = true, note: string | null = null): HTMLElement {
  return h(
    'section',
    { class: 'panel waiting' },
    spin ? h('div', { class: 'spinner', 'aria-hidden': 'true' }) : null,
    h('h2', null, title),
    h('p', { class: 'muted' }, text),
    note ? h('p', { class: 'muted small' }, note) : null,
  );
}

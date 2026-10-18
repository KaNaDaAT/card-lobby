/**
 * A room: opens the transport, becomes host or client, and draws the lobby or the table from
 * the session's latest view. Chat sits beside both.
 */
import { isHosting, loadIdentity, loadRoomSnapshot, safeColor, saveRoomSnapshot } from '../../identity';
import { formatCode } from '../../net/code';
import { joinLocalRoom } from '../../net/local';
import { CHAT_MAX_LENGTH, type ChatMessage, type View } from '../../net/protocol';
import type { Transport } from '../../net/transport';
import { loadBuiltInPacks } from '../../packs/load';
import { ClientSession } from '../../session/client';
import { HostSession } from '../../session/host';
import type { Session, SessionState } from '../../session/types';
import { avatar, brandMark, pill } from '../components/bits';
import { h, replace, type Child } from '../dom';
import { roomLink, type Screen } from '../router';
import { lobbyMain, playersPanel, type RoomCtx } from './lobby';

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

  const sendChat = (e: Event) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ctx) return;
    ctx.session.say(text);
    chatInput.value = '';
  };

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
      h(
        'aside',
        { class: 'col-side' },
        sideRegion,
        h(
          'section',
          { class: 'panel chat' },
          h('div', { class: 'panel-head' }, h('h2', null, 'Chat')),
          chatLog,
          h('form', { class: 'chat-form', onsubmit: sendChat }, chatInput, chatSend),
        ),
      ),
    ),
  );
  root.append(room);
  replace(mainRegion, waitingPanel('Connecting', local ? 'Opening a local room for tabs in this browser.' : 'Joining the room.'));

  const draw = () => {
    if (!ctx) return;
    const state = ctx.session.state();
    const view = state.view;
    const lp = ctx.packs.find((p) => p.pack.id === view?.lobby.packId);
    const accent = lp?.pack.art.accent;
    room.style.setProperty('--accent', accent && CSS.supports('color', accent) ? accent : DEFAULT_ACCENT);

    const canTalk = ctx.session.isHost || state.status === 'connected';
    chatInput.disabled = !canTalk;
    chatSend.disabled = !canTalk;

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
      replace(mainRegion, mainContent(ctx, view));
      replace(sideRegion, playersPanel(ctx, view.lobby));
    }
    if (state.chat !== drawnChat) drawChat(ctx, state, view);
  };

  const drawChat = (c: RoomCtx, state: SessionState, view: View | null) => {
    drawnChat = state.chat;
    const colors = new Map(view?.lobby.players.map((p) => [p.playerId, p.color]));
    const stick = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
    replace(
      chatLog,
      state.chat.map((m) => {
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

  void (async () => {
    try {
      const packs = await loadBuiltInPacks();
      if (disposed) return;
      // The session must exist before any network event runs, or it misses peer joins.
      const transport = await openTransport(code, local);
      if (disposed) {
        transport.leave();
        return;
      }
      const session: Session = isHosting(code)
        ? new HostSession({
            code,
            me,
            transport,
            packs,
            store: { load: () => loadRoomSnapshot(code), save: (data) => saveRoomSnapshot(code, data) },
          })
        : new ClientSession({ code, me, transport });
      ctx = { session, me, packs };
      session.subscribe(draw);
      draw();
    } catch (err) {
      if (!disposed) replace(mainRegion, waitingPanel('Something went wrong', String(err), false));
    }
  })();

  return () => {
    disposed = true;
    ctx?.session.leave();
  };
};

function mainContent(ctx: RoomCtx, view: View): Child[] {
  if (view.lobby.phase === 'lobby' || !view.game) return lobbyMain(ctx, view.lobby);
  return [waitingPanel('Game in progress', 'The table arrives with milestone 3.', false)];
}

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

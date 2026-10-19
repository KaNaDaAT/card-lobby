import { describe, expect, it } from 'vitest';
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import bigLitterJson from '../../public/packs/power-hungry-pets/addons/big-litter.json';
import type { Identity } from '../identity';
import { createMemoryNetwork } from '../net/memory';
import { ACTION, PROTOCOL_VERSION, type View } from '../net/protocol';
import type { Addon, LoadedPack, Pack } from '../packs/types';
import { ClientSession } from './client';
import { HostSession, parseIntent, type SnapshotStore } from './host';

const CODE = 'ABCDEFGH';
const pets: LoadedPack = {
  key: 'power-hungry-pets',
  pack: petsJson as unknown as Pack,
  addons: [bigLitterJson as unknown as Addon],
  asset: (p) => p,
};

const id = (name: string, color = '#4cc9f0'): Identity => ({ playerId: `id-${name}`, name, color });

function memoryStore(): SnapshotStore & { data: string | null } {
  return {
    data: null,
    load() {
      return this.data;
    },
    save(d) {
      this.data = d;
    },
  };
}

function setup() {
  const net = createMemoryNetwork();
  const store = memoryStore();
  let clock = 1000;
  const host = new HostSession({
    code: CODE,
    me: id('Hana', '#f2a93b'),
    transport: net.join('host'),
    packs: [pets],
    store,
    now: () => clock++,
  });
  const join = (name: string, peer = name.toLowerCase()) =>
    new ClientSession({ code: CODE, me: id(name), transport: net.join(peer) });
  return { net, store, host, join, advance: (ms: number) => (clock += ms) };
}

const names = (view: View | null) => view?.lobby.players.map((p) => `${p.name}${p.connected ? '' : ' (away)'}`);

describe('host and client sessions', () => {
  it('lets a client join, see the lobby and chat', () => {
    const { net, host, join } = setup();
    const tom = join('Tom');
    expect(tom.state().status).toBe('connecting');
    net.flush();

    expect(tom.state().status).toBe('connected');
    expect(names(tom.state().view)).toEqual(['Hana', 'Tom']);
    expect(names(host.state().view)).toEqual(['Hana', 'Tom']);
    expect(tom.state().view?.lobby.packId).toBe('power-hungry-pets');
    expect(tom.state().view?.lobby.players[0]?.isHost).toBe(true);

    tom.say('  hi all  ');
    net.flush();
    host.say('welcome');
    net.flush();
    const texts = (s: { state(): { chat: { text: string }[] } }) => s.state().chat.map((m) => m.text);
    expect(texts(host)).toEqual(['Lobby created. Share the link or code to invite friends.', 'Tom joined.', 'hi all', 'welcome']);
    expect(texts(tom)).toEqual(texts(host));
  });

  it('sends chat history to late joiners and caps message length', () => {
    const { net, host, join } = setup();
    host.say('x'.repeat(600));
    host.say('   ');
    const mia = join('Mia');
    net.flush();
    const chat = mia.state().chat;
    expect(chat.map((m) => m.text.length)).toEqual([chat[0]!.text.length, 500, 'Mia joined.'.length]);
  });

  it('slows chat down for players, tells only the sender, and lets the host clear it', () => {
    const { net, store, host, join, advance } = setup();
    const tom = join('Tom');
    const mia = join('Mia');
    net.flush();
    const texts = (s: { state(): { chat: { text: string }[] } }) => s.state().chat.map((m) => m.text);
    const notice = 'Slow mode: one message every 2 seconds.';

    tom.say('one');
    net.flush();
    tom.say('two');
    net.flush();
    advance(2000);
    tom.say('three');
    net.flush();
    host.say('the host is never slowed');
    host.say('really');
    net.flush();
    expect(texts(host).slice(-4)).toEqual(['one', 'three', 'the host is never slowed', 'really']);
    expect(texts(tom)).toContain(notice);
    expect(texts(mia)).not.toContain(notice);

    tom.act({ kind: 'clearChat' });
    tom.act({ kind: 'setChatCooldown', seconds: 0 });
    net.flush();
    expect(host.state().view?.lobby.chatCooldown).toBe(2);
    expect(texts(host)).toContain('one');

    host.act({ kind: 'setChatCooldown', seconds: 0 });
    host.act({ kind: 'clearChat' });
    net.flush();
    expect(texts(host)).toEqual(['The host cleared the chat.']);
    expect(texts(mia)).toEqual(['The host cleared the chat.']);
    expect(mia.state().view?.lobby.chatCooldown).toBe(0);
    tom.say('a');
    tom.say('b');
    net.flush();
    expect(texts(mia).slice(-2)).toEqual(['a', 'b']);

    const again = new HostSession({ code: CODE, me: id('Hana', '#f2a93b'), transport: net.join('host-again'), packs: [pets], store });
    expect(again.state().view?.lobby.chatCooldown).toBe(0);
  });

  it('only lets the host change the lobby, and checks values', () => {
    const { net, host, join } = setup();
    const tom = join('Tom');
    net.flush();

    tom.act({ kind: 'setOption', id: 'tieBreak', value: 'sumPlayed' });
    net.flush();
    expect(host.state().view?.lobby.options).toEqual({});

    host.act({ kind: 'setOption', id: 'tieBreak', value: 'sumPlayed' });
    host.act({ kind: 'setOption', id: 'tieBreak', value: 'coinFlip' });
    host.act({ kind: 'setOption', id: 'tokensToWin', value: 99 });
    host.act({ kind: 'setOption', id: 'tokensToWin', value: 4 });
    host.act({ kind: 'toggleAddon', addonId: 'big-litter', on: true });
    host.act({ kind: 'toggleAddon', addonId: 'no-such-addon', on: true });
    net.flush();
    expect(tom.state().view?.lobby.options).toEqual({ tieBreak: 'sumPlayed', tokensToWin: 4 });
    expect(tom.state().view?.lobby.addons).toEqual(['big-litter']);

    host.act({ kind: 'selectPack', packId: 'power-hungry-pets' });
    net.flush();
    expect(tom.state().view?.lobby.options).toEqual({});
    expect(tom.state().view?.lobby.addons).toEqual([]);
  });

  it('explains why Start is blocked', () => {
    const { net, host, join } = setup();
    expect(host.state().view?.lobby.startBlocked).toBe('Needs at least 2 players, 1 here.');
    const tom = join('Tom');
    net.flush();
    expect(host.state().view?.lobby.startBlocked).toBeNull();

    tom.leave();
    net.flush();
    expect(names(host.state().view)).toEqual(['Hana', 'Tom (away)']);
    expect(host.state().view?.lobby.startBlocked).toBe('Waiting for Tom to come back.');

    host.act({ kind: 'removePlayer', playerId: 'id-Tom' });
    expect(names(host.state().view)).toEqual(['Hana']);
  });

  it('makes players beyond the maximum spectators', () => {
    const { net, host, join } = setup();
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) join(n);
    net.flush();
    const roles = () => host.state().view!.lobby.players.map((p) => p.role[0]).join('');
    expect(roles()).toBe('pppppps');
    host.act({ kind: 'toggleAddon', addonId: 'big-litter', on: true });
    expect(roles()).toBe('ppppppp');
  });

  it('gives a reconnecting player their seat back', () => {
    const { net, host, join } = setup();
    const tom = join('Tom');
    join('Mia');
    net.flush();
    tom.leave();
    net.flush();
    expect(names(host.state().view)).toEqual(['Hana', 'Tom (away)', 'Mia']);

    const again = join('Tom', 'tom-2');
    net.flush();
    expect(names(again.state().view)).toEqual(['Hana', 'Tom', 'Mia']);
    expect(again.state().chat.at(-1)?.text).toBe('Tom is back.');
  });

  it('lets the newest connection win when one playerId connects twice', () => {
    const { net, host, join } = setup();
    const first = join('Tom', 'tom-a');
    net.flush();
    const second = join('Tom', 'tom-b');
    net.flush();
    expect(names(host.state().view)).toEqual(['Hana', 'Tom']);
    const before = first.state().view!.seq;
    host.say('ping');
    host.act({ kind: 'setOption', id: 'tieBreak', value: 'sumPlayed' });
    net.flush();
    expect(first.state().view!.seq).toBe(before);
    expect(second.state().view?.lobby.options).toEqual({ tieBreak: 'sumPlayed' });
  });

  it('resumes the lobby when the host reloads, and clients follow', () => {
    const { net, store, host, join } = setup();
    const tom = join('Tom');
    net.flush();
    host.act({ kind: 'setOption', id: 'tieBreak', value: 'sumPlayed' });
    tom.say('before reload');
    net.flush();

    host.leave();
    net.flush();
    expect(tom.state().status).toBe('hostAway');

    const reloaded = new HostSession({ code: CODE, me: id('Hana', '#f2a93b'), transport: net.join('host-2'), packs: [pets], store });
    expect(names(reloaded.state().view)).toEqual(['Hana', 'Tom (away)']);
    net.flush();
    expect(tom.state().status).toBe('connected');
    expect(names(tom.state().view)).toEqual(['Hana', 'Tom']);
    expect(tom.state().view?.lobby.options).toEqual({ tieBreak: 'sumPlayed' });
    expect(tom.state().chat.map((m) => m.text)).toContain('before reload');
    expect(tom.state().chat.at(-1)?.text).toBe('before reload');
  });

  it('ignores views from impostors and stale views', () => {
    const { net, join } = setup();
    const tom = join('Tom');
    net.flush();
    const seq = tom.state().view!.seq;
    const evil = net.join('evil');
    const lobby = tom.state().view!.lobby;
    void evil.channel<View>(ACTION.view).send({ seq: 999, hostPlayerId: 'id-Evil', lobby, game: null }, 'tom');
    net.flush();
    expect(tom.state().view!.seq).toBe(seq);
  });

  it('tells clients with another protocol version to update', () => {
    const { net } = setup();
    const old = net.join('old');
    let got: View | null = null;
    old.channel<View>(ACTION.view).onMessage((v) => (got = v));
    void old.channel(ACTION.hello).send({ protocol: PROTOCOL_VERSION + 1, playerId: 'x', name: 'Old', color: '#000000', cachedPacks: [] }, 'host');
    net.flush();
    expect(got!.outdated).toBe(true);
  });

  it('rejects malformed input', () => {
    const { net, host } = setup();
    const raw = net.join('raw');
    for (const bad of [null, 'hi', { protocol: 1 }, { protocol: 1, playerId: '', name: 'x', color: '#fff' }]) {
      void raw.channel(ACTION.hello).send(bad, 'host');
    }
    void raw.channel(ACTION.say).send('not a member yet', 'host');
    net.flush();
    expect(names(host.state().view)).toEqual(['Hana']);
    expect(host.state().chat).toHaveLength(1);

    expect(parseIntent({ kind: 'selectPack' })).toBeNull();
    expect(parseIntent({ kind: 'nope' })).toBeNull();
    expect(parseIntent({ kind: 'setOption', id: 'x', value: { evil: 1 } })).toBeNull();
    expect(parseIntent({ kind: 'start', extra: 1 })).toEqual({ kind: 'start' });
    expect(parseIntent({ kind: 'setChatCooldown', seconds: 5 })).toEqual({ kind: 'setChatCooldown', seconds: 5 });
    expect(parseIntent({ kind: 'setChatCooldown', seconds: 7 })).toBeNull();
    expect(parseIntent({ kind: 'setCardCount', cardId: 'king-cat', count: '3' })).toBeNull();
  });
});

/** Answers this session's open prompt with its first choice. Returns false when it has none. */
function answerFirst(s: ClientSession | HostSession): boolean {
  const p = s.state().view?.game?.prompt;
  if (!p) return false;
  const value =
    p.kind === 'play' ? [p.choices[0]] : p.kind === 'confirm' ? false : p.kind === 'choosePosition' ? 0 : p.choices[0];
  s.act({ kind: 'answer', promptId: p.id, value });
  return true;
}

function gameSetup() {
  const net = createMemoryNetwork();
  const store = memoryStore();
  const host = new HostSession({ code: CODE, me: id('Hana', '#f2a93b'), transport: net.join('host'), packs: [pets], store, seed: () => 7 });
  const tom = new ClientSession({ code: CODE, me: id('Tom'), transport: net.join('tom') });
  net.flush();
  return { net, store, host, tom };
}

describe('games through the session', () => {
  it('plays a whole game between host and client', () => {
    const { net, host, tom } = gameSetup();
    tom.act({ kind: 'start' });
    net.flush();
    expect(host.state().view?.game).toBeNull();

    host.act({ kind: 'start' });
    net.flush();
    expect(tom.state().view?.lobby.phase).toBe('playing');
    expect(tom.state().view?.game?.you).toBe(1);
    expect(host.state().view?.game?.you).toBe(0);
    expect(tom.state().view?.game?.hand.length).toBeGreaterThan(0);

    for (let i = 0; i < 2000 && host.state().view?.game?.phase !== 'gameOver'; i++) {
      const game = host.state().view!.game!;
      if (game.phase === 'roundOver') {
        tom.act({ kind: 'nextRound' });
        net.flush();
        expect(host.state().view!.game!.phase).toBe('roundOver');
        host.act({ kind: 'nextRound' });
      } else if (!answerFirst(host)) {
        expect(answerFirst(tom)).toBe(true);
      }
      net.flush();
    }
    const end = tom.state().view!.game!;
    expect(end.phase).toBe('gameOver');
    expect(end.winners.length).toBeGreaterThan(0);

    host.act({ kind: 'rematch' });
    net.flush();
    expect(tom.state().view!.game!.round).toBe(1);
    host.act({ kind: 'endGame' });
    net.flush();
    expect(tom.state().view!.game).toBeNull();
    expect(tom.state().view!.lobby.phase).toBe('lobby');
  });

  it('lets the host change card counts, checks them, and keeps them for the game', () => {
    const { net, store, host, tom } = gameSetup();
    const counts = () => tom.state().view!.lobby.counts;
    tom.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 1 });
    host.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 99 });
    host.act({ kind: 'setCardCount', cardId: 'no-such-card', count: 2 });
    net.flush();
    expect(counts()).toEqual({});

    host.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 8 });
    host.act({ kind: 'setCardCount', cardId: 'king-cat', count: 0 });
    net.flush();
    expect(counts()).toEqual({ 'crystal-bowl': 8, 'king-cat': 0 });
    host.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 5 });
    net.flush();
    expect(counts()).toEqual({ 'king-cat': 0 });

    for (const cardId of ['crystal-bowl', 'mouse-trapper', 'battle-bunny', 'shell-shield', 'snake-sorcerer']) host.act({ kind: 'setCardCount', cardId, count: 0 });
    expect(host.state().view!.lobby.startBlocked).toMatch(/^With these card counts and 2 players, the draw pile is down to 0/);
    host.act({ kind: 'resetCardCounts' });
    net.flush();
    expect(counts()).toEqual({});

    host.act({ kind: 'setCardCount', cardId: 'king-cat', count: 0 });
    host.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 9 });
    host.act({ kind: 'start' });
    host.act({ kind: 'setCardCount', cardId: 'crystal-bowl', count: 2 });
    net.flush();
    expect(counts()).toEqual({ 'king-cat': 0, 'crystal-bowl': 9 });
    const saved = JSON.parse(store.data!) as { game: { state: { cards: Record<string, { cardId: string }> } } };
    const ids = Object.values(saved.game.state.cards).map((c) => c.cardId);
    expect(ids).not.toContain('king-cat');
    expect(ids.filter((c) => c === 'crystal-bowl')).toHaveLength(9);
    expect(ids).toHaveLength(21 - 1 + 4);

    const reloaded = new HostSession({ code: CODE, me: id('Hana', '#f2a93b'), transport: net.join('host-2'), packs: [pets], store });
    expect(reloaded.state().view!.lobby.counts).toEqual({ 'king-cat': 0, 'crystal-bowl': 9 });
  });

  it('lets the host pick the seats, load counts at once, and end a game early', () => {
    const { net, host, tom } = gameSetup();
    const lobby = () => tom.state().view!.lobby;
    tom.act({ kind: 'setSeats', seats: 3 });
    host.act({ kind: 'setSeats', seats: 1 });
    host.act({ kind: 'setSeats', seats: 13 });
    net.flush();
    expect(lobby().seats).toBeNull();
    host.act({ kind: 'setSeats', seats: 8 });
    net.flush();
    expect(lobby().seats).toBe(8);
    expect(lobby().startBlocked).toBeNull();
    host.act({ kind: 'setSeats', seats: 6 });
    net.flush();
    expect(lobby().seats).toBeNull();

    host.act({ kind: 'setCardCounts', counts: { 'king-cat': 0, 'crystal-bowl': 5, 'no-such-card': 3 } });
    net.flush();
    expect(lobby().counts).toEqual({ 'king-cat': 0 });

    host.act({ kind: 'start' });
    tom.act({ kind: 'endGame' });
    net.flush();
    expect(lobby().phase).toBe('playing');
    host.act({ kind: 'endGame' });
    net.flush();
    expect(lobby().phase).toBe('lobby');
    expect(tom.state().chat.at(-1)?.text).toBe('The host ended the game. Back to the lobby.');
  });

  it('ignores answers from the wrong player', () => {
    const { net, host, tom } = gameSetup();
    host.act({ kind: 'start' });
    net.flush();
    const game = host.state().view!.game!;
    const asked = game.prompt ? host : tom;
    const other = asked === host ? tom : host;
    const p = asked.state().view!.game!.prompt!;
    expect(other.state().view!.game!.prompt).toBeNull();
    other.act({ kind: 'answer', promptId: p.id, value: p.kind === 'play' ? [p.choices[0]] : 0 });
    net.flush();
    expect(asked.state().view!.game!.prompt?.id).toBe(p.id);
  });

  it('marks players away, resumes after a host reload mid-game, and lets the client go on', () => {
    const { net, store, host, tom } = gameSetup();
    host.act({ kind: 'start' });
    net.flush();
    tom.leave();
    net.flush();
    expect(host.state().view!.game!.players[1]!.connected).toBe(false);

    const tom2 = new ClientSession({ code: CODE, me: id('Tom'), transport: net.join('tom-2') });
    net.flush();
    expect(host.state().view!.game!.players[1]!.connected).toBe(true);
    const before = host.state().view!.game!;

    host.leave();
    net.flush();
    const reloaded = new HostSession({ code: CODE, me: id('Hana', '#f2a93b'), transport: net.join('host-2'), packs: [pets], store });
    net.flush();
    const after = reloaded.state().view!.game!;
    expect(after.round).toBe(before.round);
    expect(after.waiting).toEqual(before.waiting);
    expect(tom2.state().status).toBe('connected');
    expect(tom2.state().view!.game!.players[1]!.connected).toBe(true);
    const asked = after.prompt ? reloaded : tom2;
    expect(answerFirst(asked)).toBe(true);
    net.flush();
    expect(reloaded.state().view!.game!.log.length).toBeGreaterThan(before.log.length);
  });

  it('seats late joiners as spectators who see only public cards', () => {
    const { net, host } = gameSetup();
    host.act({ kind: 'start' });
    net.flush();
    const mia = new ClientSession({ code: CODE, me: id('Mia'), transport: net.join('mia') });
    net.flush();
    const view = mia.state().view!;
    expect(view.game?.you).toBeNull();
    expect(view.game?.hand).toEqual([]);
    expect(view.lobby.players.find((p) => p.name === 'Mia')?.role).toBe('spectator');
    expect(view.game?.players.every((p) => p.hand.known.length === 0)).toBe(true);
  });

  it('lets the host hand an away seat to a new device, and kick a player for the round', () => {
    const net = createMemoryNetwork();
    const host = new HostSession({ code: CODE, me: id('Hana'), transport: net.join('host'), packs: [pets], seed: () => 3 });
    const tom = new ClientSession({ code: CODE, me: id('Tom'), transport: net.join('tom') });
    new ClientSession({ code: CODE, me: id('Mia'), transport: net.join('mia') });
    net.flush();
    host.act({ kind: 'start' });
    net.flush();
    tom.leave();
    const phone = new ClientSession({ code: CODE, me: id('TomPhone'), transport: net.join('phone') });
    net.flush();
    expect(phone.state().view!.game!.you).toBeNull();
    host.act({ kind: 'assignSeat', seatOf: 'id-Tom', to: 'id-TomPhone' });
    net.flush();
    expect(phone.state().view!.game!.you).toBe(1);
    expect(phone.state().view!.game!.players[1]!.name).toBe('TomPhone');

    const mia = host.state().view!.game!.players[2]!;
    host.act({ kind: 'kickForRound', playerId: 'id-Mia' });
    net.flush();
    expect(host.state().view!.game!.players[2]!.round).toBe(mia.round === 'in' ? 'out' : mia.round);
  });

  it('explains why the next round cannot start', () => {
    const { net, host, tom } = gameSetup();
    host.act({ kind: 'start' });
    net.flush();
    for (let i = 0; i < 200 && host.state().view!.game!.phase === 'round'; i++) {
      if (!answerFirst(host)) answerFirst(tom);
      net.flush();
    }
    expect(host.state().view!.game!.phase).toBe('roundOver');
    tom.leave();
    net.flush();
    expect(host.state().view!.lobby.startBlocked).toBe('Waiting for Tom to come back.');
  });
});

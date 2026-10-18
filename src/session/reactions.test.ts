/** Reaction windows through the session: the host times them, players Nope by intent. */
import { describe, expect, it } from 'vitest';
import kittensJson from '../../public/packs/exploding-kittens/pack.json';
import type { Identity } from '../identity';
import { createMemoryNetwork } from '../net/memory';
import type { LoadedPack, Pack } from '../packs/types';
import { ClientSession } from './client';
import { HostSession, type Timers } from './host';

const CODE = 'ABCDEFGH';
const id = (name: string): Identity => ({ playerId: `id-${name}`, name, color: '#4cc9f0' });
const kittens: LoadedPack = { key: 'exploding-kittens', pack: kittensJson as unknown as Pack, addons: [], asset: (p) => p };

/** Timers the test fires by hand, against a clock it moves. */
function manualTimers() {
  const pending: { fn: () => void; at: number }[] = [];
  const clock = { now: 0 };
  const timers: Timers = {
    set: (fn, ms) => {
      const t = { fn, at: clock.now + ms };
      pending.push(t);
      return t;
    },
    clear: (handle) => {
      const i = pending.indexOf(handle as (typeof pending)[number]);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  /** Moves the clock to the next timer and fires it. */
  const fireNext = () => {
    pending.sort((a, b) => a.at - b.at);
    const t = pending.shift();
    if (!t) throw new Error('no timer pending');
    clock.now = t.at;
    t.fn();
  };
  return { timers, clock, pending, fireNext };
}

function game(seed: number) {
  const net = createMemoryNetwork();
  const t = manualTimers();
  const host = new HostSession({
    code: CODE,
    me: id('Hana'),
    transport: net.join('host'),
    packs: [kittens],
    seed: () => seed,
    now: () => t.clock.now,
    timers: t.timers,
  });
  const tom = new ClientSession({ code: CODE, me: id('Tom'), transport: net.join('tom') });
  net.flush();
  host.act({ kind: 'start' });
  net.flush();
  return { net, host, tom, ...t };
}

describe('reaction windows', () => {
  it('opens a window for each play, lets the other player Nope it, and closes it on time', () => {
    // Find a deal where the active player can play a card on its own and the other holds a Nope.
    for (let seed = 1; seed < 200; seed++) {
      const g = game(seed);
      const sessions = [g.host, g.tom];
      const active = sessions.find((s) => s.state().view?.game?.prompt?.kind === 'play');
      const other = sessions.find((s) => s !== active)!;
      const prompt = active?.state().view?.game?.prompt;
      if (!active || prompt?.kind !== 'play') continue;
      const hand = active.state().view!.game!.hand;
      const card = prompt.alone.find((uid) => ['skip', 'shuffle', 'attack'].includes(hand.find((c) => c.uid === uid)!.cardId));
      if (!card) continue;

      active.act({ kind: 'answer', promptId: prompt.id, value: [card] });
      g.net.flush();
      const window = other.state().view!.game!.window;
      expect(window).toMatchObject({ remainingMs: 4000, canceled: false });
      expect(g.pending).toHaveLength(1);
      const nopes = other.state().view!.game!.reactWith;
      if (!nopes.length) continue;

      g.clock.now = 1500;
      other.act({ kind: 'react', uid: nopes[0]! });
      g.net.flush();
      expect(active.state().view!.game!.window).toMatchObject({ canceled: true, remainingMs: 4000, reactions: 1 });
      // The timer moved with the window's new end.
      expect(g.pending.map((p) => p.at)).toEqual([5500]);

      g.fireNext();
      g.net.flush();
      expect(active.state().view!.game!.window).toBeNull();
      // The play was stopped, so the same player is asked again.
      expect(active.state().view!.game!.prompt?.kind).toBe('play');
      expect(g.pending).toHaveLength(0);
      return;
    }
    throw new Error('no seed gave a playable card and a Nope');
  });

  it('closes a window the host left open when it reloads', () => {
    for (let seed = 1; seed < 50; seed++) {
      const net = createMemoryNetwork();
      const t = manualTimers();
      let saved: string | null = null;
      const store = { load: () => saved, save: (d: string) => void (saved = d) };
      const opts = { code: CODE, me: id('Hana'), packs: [kittens], seed: () => seed, now: () => t.clock.now, timers: t.timers, store };
      const host = new HostSession({ ...opts, transport: net.join('host') });
      new ClientSession({ code: CODE, me: id('Tom'), transport: net.join('tom') });
      net.flush();
      host.act({ kind: 'start' });
      const prompt = host.state().view!.game!.prompt;
      if (prompt?.kind !== 'play') continue;
      const card = prompt.alone.find((uid) => host.state().view!.game!.hand.find((c) => c.uid === uid)!.cardId === 'shuffle');
      if (!card) continue;
      host.act({ kind: 'answer', promptId: prompt.id, value: [card] });
      host.leave();
      expect(t.pending).toHaveLength(0);

      t.clock.now = 1000;
      const reloaded = new HostSession({ ...opts, transport: net.join('host-2') });
      expect(reloaded.state().view!.game!.window).toMatchObject({ remainingMs: 3000 });
      expect(t.pending.map((p) => p.at)).toEqual([4000]);
      t.fireNext();
      expect(reloaded.state().view!.game!.window).toBeNull();
      expect(reloaded.state().view!.game!.prompt?.kind).toBe('play');
      return;
    }
    throw new Error('no seed gave the host a Shuffle');
  });
});

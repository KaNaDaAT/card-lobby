/** Custom games and addons through the session: offer, consent, transfer, checks, cache. */
import { describe, expect, it } from 'vitest';
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import type { Identity } from '../identity';
import { createMemoryNetwork } from '../net/memory';
import { ACTION, PROTOCOL_VERSION } from '../net/protocol';
import { importPackZip, importZip } from '../packs/custom';
import type { PackLoader } from '../packs/loader';
import type { LoadedAddon, LoadedPack, Pack } from '../packs/types';
import { writeZip } from '../packs/zip';
import { ClientSession } from './client';
import { HostSession } from './host';

const CODE = 'ABCDEFGH';
const id = (name: string): Identity => ({ playerId: `id-${name}`, name, color: '#4cc9f0' });
const url = (blob: Blob) => `blob:test/${blob.size}`;

const PETS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../public/packs/power-hungry-pets/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([path, text]) => [path.replace('../../public/packs/power-hungry-pets/', ''), text]),
);

/** A custom pack: Power Hungry Pets renamed, so it is clearly not the built-in one. */
async function customPack(): Promise<LoadedPack> {
  const pack = { ...(petsJson as unknown as Pack), id: 'house-pets', name: 'House Pets' };
  return importPackZip(await writeZip({ ...PETS, 'pack.json': JSON.stringify(pack) }), { url });
}

const builtIn: LoadedPack = { key: 'power-hungry-pets', pack: petsJson as unknown as Pack, addons: [], asset: (p) => p };

function memoryLoader(): PackLoader & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async cached(hash) {
      const bytes = store.get(hash);
      return bytes ? importZip(bytes, { url, expectHash: hash }) : null;
    },
    async load(bytes, hash) {
      const item = await importZip(bytes, { url, expectHash: hash });
      store.set(hash, bytes);
      return item;
    },
  };
}

/** Delivers messages and lets async pack work (hashing, unzipping) finish. */
async function settle(net: ReturnType<typeof createMemoryNetwork>): Promise<void> {
  for (let i = 0; i < 30; i++) {
    net.flush();
    await new Promise((r) => setTimeout(r, 2));
  }
}

async function setup() {
  const net = createMemoryNetwork();
  const host = new HostSession({ code: CODE, me: id('Hana'), transport: net.join('host'), packs: [builtIn], seed: () => 5 });
  const join = (name: string, loader = memoryLoader(), peer = name.toLowerCase()) =>
    new ClientSession({ code: CODE, me: id(name), transport: net.join(peer), packs: loader });
  const lp = await customPack();
  return { net, host, join, lp };
}

const players = (host: HostSession) => host.state().view!.lobby.players.map((p) => `${p.name}:${p.pack}:${p.role}`);
const offerOf = (client: ClientSession, i = 0) => client.state().packOffers[i];

describe('custom packs', () => {
  it('offers the pack, asks for consent, sends it on yes and starts when everyone has it', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    await settle(net);
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    await settle(net);

    expect(tom.state().view!.lobby.customPack).toEqual(lp.custom!.offer);
    expect(offerOf(tom)).toMatchObject({ status: 'asking', offer: { name: 'House Pets' } });
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:offered:player']);
    expect(host.state().view!.lobby.startBlocked).toBe('Waiting for Tom to get the pack.');

    tom.answerPackOffer(true);
    await settle(net);
    expect(offerOf(tom)?.status).toBe('ready');
    expect(tom.state().customPack?.pack.name).toBe('House Pets');
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:ready:player']);
    expect(host.state().view!.lobby.startBlocked).toBeNull();

    host.act({ kind: 'start' });
    await settle(net);
    expect(tom.state().view!.game?.you).toBe(1);
    expect(tom.state().view!.lobby.packId).toBe(lp.key);
  });

  it('makes players who decline watch, and lets them change their mind', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    const mia = join('Mia');
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    await settle(net);
    tom.answerPackOffer(true);
    mia.answerPackOffer(false);
    await settle(net);
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:ready:player', 'Mia:declined:spectator']);
    expect(host.state().view!.lobby.startBlocked).toBeNull();

    mia.answerPackOffer(true);
    await settle(net);
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:ready:player', 'Mia:ready:player']);
  });

  it('takes a pack from the cache without asking, also after a reload', async () => {
    const { net, host, join, lp } = await setup();
    const loader = memoryLoader();
    loader.store.set(lp.custom!.offer.hash, lp.custom!.bytes);
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    const tom = join('Tom', loader);
    await settle(net);
    expect(offerOf(tom)?.status).toBe('ready');
    expect(players(host)).toContain('Tom:ready:player');

    tom.leave();
    await settle(net);
    const again = join('Tom', loader, 'tom-2');
    await settle(net);
    expect(again.state().customPack?.custom?.offer.hash).toBe(lp.custom!.offer.hash);
    expect(players(host)).toContain('Tom:ready:player');
  });

  it('refuses a download that does not match the offer', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    const broken: LoadedPack = { ...lp, custom: { ...lp.custom!, bytes: lp.custom!.bytes.slice() } };
    broken.custom!.bytes[100] = broken.custom!.bytes[100]! ^ 0xff;
    host.addPack(broken);
    host.act({ kind: 'selectPack', packId: broken.key });
    await settle(net);
    tom.answerPackOffer(true);
    await settle(net);
    expect(offerOf(tom)).toMatchObject({ status: 'failed', error: 'The pack arrived damaged (its checksum does not match).' });
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:failed:spectator']);
    expect(host.state().chat.at(-1)?.text).toBe('Tom could not load House Pets: The pack arrived damaged (its checksum does not match).');
  });

  it('ignores pack data nobody asked for or from anyone but the host', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    await settle(net);
    const evil = net.join('evil');
    void evil.channel<Uint8Array>(ACTION.packData).send(lp.custom!.bytes, 'tom');
    await settle(net);
    expect(offerOf(tom)?.status).toBe('asking');
    expect(tom.state().customPack).toBeNull();
  });

  it('sends the pack a limited number of times', async () => {
    const { net, host, lp } = await setup();
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    const greedy = net.join('greedy');
    let received = 0;
    greedy.channel<Uint8Array>(ACTION.packData).onMessage(() => received++);
    void greedy.channel(ACTION.hello).send({ protocol: PROTOCOL_VERSION, playerId: 'g', name: 'Greedy', color: '#000000', cachedPacks: [] }, 'host');
    await settle(net);
    for (let i = 0; i < 6; i++) {
      // Decline in between, so the host is not waiting on a transfer.
      void greedy.channel(ACTION.packReply).send({ hash: lp.custom!.offer.hash, accept: true }, 'host');
      await settle(net);
      void greedy.channel(ACTION.packReply).send({ hash: lp.custom!.offer.hash, accept: false }, 'host');
      await settle(net);
    }
    expect(received).toBe(3);
  });

  it('keeps uploaded packs in the gallery, and only removes unused ones', async () => {
    const { host, lp } = await setup();
    host.addPack(lp);
    host.addPack(lp);
    expect(host.availablePacks().map((p) => p.key)).toEqual(['power-hungry-pets', lp.key]);
    host.act({ kind: 'selectPack', packId: lp.key });
    expect(host.removePack(lp.key)).toBe(false);
    host.act({ kind: 'selectPack', packId: 'power-hungry-pets' });
    expect(host.removePack(lp.key)).toBe(true);
    expect(host.removePack('power-hungry-pets')).toBe(false);
  });
});

/** A small addon zip: one more card, with art. */
async function goldBowls(gameId = 'power-hungry-pets', description = 'One more card.'): Promise<LoadedAddon> {
  const id = 'gold-bowls';
  const addon = {
    format: 1,
    id,
    name: 'Gold Bowls',
    description,
    extends: gameId,
    author: 'A Friend',
    image: 'art/gold.svg',
    cards: { add: [{ id: `${id}-card`, name: 'Gold Bowl', value: 1, count: 1, text: 'No action.', image: 'art/gold.svg' }] },
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
  const item = await importZip(await writeZip({ 'addon.json': JSON.stringify(addon), 'art/gold.svg': svg }), { url });
  if (item.kind !== 'addon') throw new Error('expected an addon');
  return item.addon;
}

describe('addon zips', () => {
  it('joins its game, is offered once it is on, and the game plays with it', async () => {
    const { net, host, join } = await setup();
    const tom = join('Tom');
    await settle(net);
    const addon = await goldBowls();
    expect(host.addAddon(addon)).toEqual([]);
    expect(host.availablePacks()[0]!.addons.map((a) => a.id)).toContain('gold-bowls');
    await settle(net);
    expect(tom.state().view!.lobby.customAddons).toEqual([]);
    expect(tom.state().packOffers).toEqual([]);

    host.act({ kind: 'toggleAddon', addonId: 'gold-bowls', on: true });
    await settle(net);
    expect(tom.state().view!.lobby.customAddons).toEqual([addon.custom.offer]);
    expect(offerOf(tom)).toMatchObject({ status: 'asking', offer: { kind: 'addon', extends: 'power-hungry-pets', author: 'A Friend' } });
    expect(host.state().view!.lobby.startBlocked).toBe('Waiting for Tom to get the pack.');

    tom.answerPackOffer(true);
    await settle(net);
    expect(tom.state().customAddons.map((a) => a.addon.id)).toEqual(['gold-bowls']);
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:ready:player']);
    host.act({ kind: 'start' });
    await settle(net);
    expect(tom.state().view!.game?.you).toBe(1);
    expect(tom.state().view!.lobby.addons).toEqual(['gold-bowls']);
  });

  it('refuses an addon for a game the lobby does not have, or one already there', async () => {
    const { host } = await setup();
    expect(host.addAddon(await goldBowls('chess'))).toEqual(['Gold Bowls is an addon for the game "chess", which this lobby does not have.']);
    expect(host.addAddon(await goldBowls())).toEqual([]);
    // The same zip again is no news. A different zip with the same addon id is refused.
    expect(host.addAddon(await goldBowls())).toEqual([]);
    expect(host.addAddon(await goldBowls('power-hungry-pets', 'Changed.'))).toEqual(['Power Hungry Pets already has an addon with the id "gold-bowls".']);
  });

  it('offers a custom game and its addon together, asks once, and sends them one after the other', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    host.addPack(lp);
    const addon = await goldBowls('house-pets');
    expect(host.addAddon(addon)).toEqual([]);
    host.act({ kind: 'selectPack', packId: lp.key });
    host.act({ kind: 'toggleAddon', addonId: 'gold-bowls', on: true });
    await settle(net);
    expect(tom.state().packOffers.map((o) => `${o.offer.kind}:${o.status}`)).toEqual(['game:asking', 'addon:asking']);

    tom.answerPackOffer(true);
    await settle(net);
    expect(tom.state().packOffers.map((o) => o.status)).toEqual(['ready', 'ready']);
    expect(tom.state().customPack?.pack.name).toBe('House Pets');
    expect(tom.state().customAddons.map((a) => a.addon.id)).toEqual(['gold-bowls']);
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:ready:player']);
  });

  it('can be taken away in the lobby, but not from a running game', async () => {
    const { net, host, join } = await setup();
    const tom = join('Tom', memoryLoader());
    const addon = await goldBowls();
    host.addAddon(addon);
    host.act({ kind: 'toggleAddon', addonId: 'gold-bowls', on: true });
    await settle(net);
    expect(host.removeAddon(addon.key)).toBe(true);
    expect(host.state().view!.lobby.addons).toEqual([]);
    expect(host.availablePacks()[0]!.addons.map((a) => a.id)).not.toContain('gold-bowls');

    host.addAddon(addon);
    host.act({ kind: 'toggleAddon', addonId: 'gold-bowls', on: true });
    await settle(net);
    tom.answerPackOffer(true);
    await settle(net);
    host.act({ kind: 'start' });
    expect(host.state().view!.game).not.toBeNull();
    expect(host.removeAddon(addon.key)).toBe(false);
  });
});

/** Custom packs through the session: offer, consent, transfer, checks, cache. */
import { describe, expect, it } from 'vitest';
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import type { Identity } from '../identity';
import { createMemoryNetwork } from '../net/memory';
import { ACTION } from '../net/protocol';
import { importPackZip } from '../packs/custom';
import type { PackLoader } from '../packs/loader';
import type { LoadedPack, Pack } from '../packs/types';
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
      return bytes ? importPackZip(bytes, { url, expectHash: hash }) : null;
    },
    async load(bytes, hash) {
      const lp = await importPackZip(bytes, { url, expectHash: hash });
      store.set(hash, bytes);
      return lp;
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

describe('custom packs', () => {
  it('offers the pack, asks for consent, sends it on yes and starts when everyone has it', async () => {
    const { net, host, join, lp } = await setup();
    const tom = join('Tom');
    await settle(net);
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    await settle(net);

    expect(tom.state().view!.lobby.customPack).toEqual(lp.custom!.offer);
    expect(tom.state().packOffer).toMatchObject({ status: 'asking', offer: { name: 'House Pets' } });
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:offered:player']);
    expect(host.state().view!.lobby.startBlocked).toBe('Waiting for Tom to get the pack.');

    tom.answerPackOffer(true);
    await settle(net);
    expect(tom.state().packOffer?.status).toBe('ready');
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
    expect(tom.state().packOffer?.status).toBe('ready');
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
    expect(tom.state().packOffer).toMatchObject({ status: 'failed', error: 'The pack arrived damaged (its checksum does not match).' });
    expect(players(host)).toEqual(['Hana:ready:player', 'Tom:failed:spectator']);
    expect(host.state().chat.at(-1)?.text).toBe('Tom could not load the pack: The pack arrived damaged (its checksum does not match).');
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
    expect(tom.state().packOffer?.status).toBe('asking');
    expect(tom.state().customPack).toBeNull();
  });

  it('sends the pack a limited number of times', async () => {
    const { net, host, lp } = await setup();
    host.addPack(lp);
    host.act({ kind: 'selectPack', packId: lp.key });
    const greedy = net.join('greedy');
    let received = 0;
    greedy.channel<Uint8Array>(ACTION.packData).onMessage(() => received++);
    void greedy.channel(ACTION.hello).send({ protocol: 2, playerId: 'g', name: 'Greedy', color: '#000000', cachedPacks: [] }, 'host');
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

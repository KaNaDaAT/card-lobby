import { afterEach, describe, expect, it } from 'vitest';
import { joinLocalRoom } from './local';
import { createMemoryNetwork } from './memory';
import type { Transport } from './transport';

describe('memory network', () => {
  it('announces peers both ways and delivers to everyone or to targets', () => {
    const net = createMemoryNetwork();
    const a = net.join('a');
    const b = net.join('b');
    const c = net.join('c');
    const seenByA: string[] = [];
    a.onPeerJoin((id) => seenByA.push(id));
    const got: Record<string, string[]> = { a: [], b: [], c: [] };
    for (const t of [a, b, c]) t.channel<string>('x').onMessage((d, from) => got[t.selfId]!.push(`${from}:${d}`));
    net.flush();
    expect(seenByA.sort()).toEqual(['b', 'c']);

    void a.channel<string>('x').send('all');
    void a.channel<string>('x').send('only-c', 'c');
    net.flush();
    expect(got).toEqual({ a: [], b: ['a:all'], c: ['a:all', 'a:only-c'] });
  });

  it('clones payloads and reports leaves', () => {
    const net = createMemoryNetwork();
    const a = net.join('a');
    const b = net.join('b');
    const left: string[] = [];
    b.onPeerLeave((id) => left.push(id));
    const payload = { n: 1 };
    let received: { n: number } | null = null;
    b.channel<{ n: number }>('x').onMessage((d) => (received = d));
    void a.channel<{ n: number }>('x').send(payload);
    payload.n = 2;
    net.flush();
    expect(received).toEqual({ n: 1 });
    a.leave();
    net.flush();
    expect(left).toEqual(['a']);
  });
});

describe('local transport', () => {
  const open: Transport[] = [];
  afterEach(() => {
    for (const t of open.splice(0)) t.leave();
  });

  const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  it('finds other tabs, delivers targeted messages and notices goodbyes', async () => {
    const a = joinLocalRoom('TESTROOM');
    const b = joinLocalRoom('TESTROOM');
    const other = joinLocalRoom('OTHERONE');
    open.push(a, b, other);
    const joinedA: string[] = [];
    const leftA: string[] = [];
    a.onPeerJoin((id) => joinedA.push(id));
    a.onPeerLeave((id) => leftA.push(id));
    const gotB: unknown[] = [];
    b.channel('x').onMessage((d, from) => gotB.push([from, d]));
    const gotOther: unknown[] = [];
    other.channel('x').onMessage((d) => gotOther.push(d));
    await wait();
    expect(joinedA).toEqual([b.selfId]);

    await a.channel('x').send({ hi: 1 }, b.selfId);
    await a.channel('x').send({ hi: 2 }, 'nobody');
    await wait();
    expect(gotB).toEqual([[a.selfId, { hi: 1 }]]);
    expect(gotOther).toEqual([]);

    b.leave();
    await wait();
    expect(leftA).toEqual([b.selfId]);
  });
});

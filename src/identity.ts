/**
 * The local player's identity, kept in localStorage. `?as=<slot>` selects a separate slot so
 * several tabs in one browser can act as different players during development.
 */
export interface Identity {
  playerId: string;
  name: string;
  color: string;
}

export const PLAYER_COLORS = [
  '#f2a93b',
  '#ef476f',
  '#06d6a0',
  '#4cc9f0',
  '#9b5de5',
  '#f15bb5',
  '#90be6d',
  '#f8961e',
];

/** Colors arrive from other players, so only plain hex colors are allowed into styles. */
export function safeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : PLAYER_COLORS[0]!;
}

const ADJECTIVES =['Sleepy', 'Sneaky', 'Fluffy', 'Grumpy', 'Royal', 'Jittery', 'Brave', 'Hungry'];
const ANIMALS = ['Otter', 'Llama', 'Gecko', 'Badger', 'Panda', 'Ferret', 'Hamster', 'Corgi'];

function slot(): string {
  const as = new URLSearchParams(location.search).get('as');
  return as ? `:${as}` : '';
}

const key = (name: string) => `card-lobby:${name}${slot()}`;

function read(name: string): string | null {
  try {
    return localStorage.getItem(key(name));
  } catch {
    return null;
  }
}

function write(name: string, value: string): void {
  try {
    localStorage.setItem(key(name), value);
  } catch {
    // Storage can be blocked (private mode). The identity then lasts for this page only.
  }
}

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

let cached: Identity | null = null;

export function loadIdentity(): Identity {
  if (cached) return cached;
  let playerId = read('playerId');
  if (!playerId) {
    playerId = crypto.randomUUID();
    write('playerId', playerId);
  }
  cached = {
    playerId,
    name: read('name') ?? `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: read('color') ?? pick(PLAYER_COLORS),
  };
  return cached;
}

export function saveIdentity(patch: Partial<Pick<Identity, 'name' | 'color'>>): Identity {
  const next = { ...loadIdentity(), ...patch };
  write('name', next.name);
  write('color', next.color);
  cached = next;
  return next;
}

/** Marks this browser slot as the host of a room, so reopening the link resumes as host. */
export function markHosting(code: string): void {
  write(`host:${code}`, '1');
}

export function isHosting(code: string): boolean {
  return read(`host:${code}`) === '1';
}

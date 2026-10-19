/**
 * Card count presets the host saves in this browser, per game. A preset is the copies of each
 * card the host changed, by card id. Cards a game no longer has are skipped when it is loaded.
 */
const KEY = 'cardlobby.countPresets';

type Presets = Record<string, Record<string, number>>;

function readAll(): Record<string, Presets> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, Presets>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Presets>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private windows may refuse. The preset is then gone after a reload.
  }
}

export function countPresets(gameId: string): Presets {
  return readAll()[gameId] ?? {};
}

export function saveCountPreset(gameId: string, name: string, counts: Record<string, number>): void {
  const all = readAll();
  all[gameId] = { ...all[gameId], [name]: { ...counts } };
  writeAll(all);
}

export function deleteCountPreset(gameId: string, name: string): void {
  const all = readAll();
  if (!all[gameId]) return;
  delete all[gameId][name];
  writeAll(all);
}

import type { Addon, OptionDef, Pack } from './types';

export class MergeError extends Error {
  constructor(
    readonly addonId: string,
    readonly detail: string,
  ) {
    super(`${addonId}: ${detail}`);
  }
}

/**
 * Applies the enabled addons to a pack, in the order the pack lists them, and returns a new
 * pack. Rules are deep-merged (objects key by key, arrays and plain values replace).
 * Merge rules are documented in docs/PACK_FORMAT.md, "Addons".
 */
export function mergeAddons(pack: Pack, addons: Addon[], enabled: readonly string[]): Pack {
  const merged = structuredClone(pack);
  for (const addon of addons) {
    if (!enabled.includes(addon.id)) continue;

    if (addon.players) merged.players = { ...merged.players, ...addon.players };

    for (const id of addon.cards?.remove ?? []) {
      const i = merged.cards.findIndex((c) => c.id === id);
      if (i < 0) throw new MergeError(addon.id, `cards.remove.${id}: no card with this id`);
      merged.cards.splice(i, 1);
    }
    for (const [id, patch] of Object.entries(addon.cards?.modify ?? {})) {
      const card = merged.cards.find((c) => c.id === id);
      if (!card) throw new MergeError(addon.id, `cards.modify.${id}: no card with this id`);
      Object.assign(card, structuredClone(patch));
    }
    for (const card of addon.cards?.add ?? []) {
      if (merged.cards.some((c) => c.id === card.id)) {
        throw new MergeError(addon.id, `cards.add.${card.id}: a card with this id already exists`);
      }
      merged.cards.push(structuredClone(card));
    }

    if (addon.rules) deepMerge(merged.rules as unknown as Obj, addon.rules as unknown as Obj);

    const options = (merged.options ??= []);
    for (const [id, patch] of Object.entries(addon.options?.modify ?? {})) {
      const option = options.find((o) => o.id === id);
      if (!option) throw new MergeError(addon.id, `options.modify.${id}: no option with this id`);
      Object.assign(option, structuredClone(patch));
    }
    for (const option of addon.options?.add ?? []) {
      if (options.some((o) => o.id === option.id)) {
        throw new MergeError(addon.id, `options.add.${option.id}: an option with this id already exists`);
      }
      options.push(structuredClone(option) as OptionDef);
    }
  }
  return merged;
}

/** Where a card comes from: the game, or the addon that added it. `icon` is its set symbol. */
export interface CardOrigin {
  name: string;
  icon?: string;
}

/** The origin of every card id, in merge order, so a later addon that adds a card owns it. */
export function cardOrigins(pack: Pack, addons: Addon[], enabled: readonly string[]): Map<string, CardOrigin> {
  const origin = (name: string, icon: string | undefined): CardOrigin => (icon ? { name, icon } : { name });
  const game = origin(pack.name, pack.art.icon);
  const out = new Map(pack.cards.map((c) => [c.id, game]));
  for (const addon of addons) {
    if (!enabled.includes(addon.id)) continue;
    const from = origin(addon.name, addon.icon);
    for (const c of addon.cards?.add ?? []) out.set(c.id, from);
  }
  return out;
}

/** Problems with a set of enabled addons: unknown ids, missing requirements, conflicts. */
export function addonProblems(addons: Addon[], enabled: readonly string[]): string[] {
  const byId = new Map(addons.map((a) => [a.id, a]));
  const problems: string[] = [];
  for (const id of enabled) {
    const addon = byId.get(id);
    if (!addon) {
      problems.push(`Unknown addon "${id}"`);
      continue;
    }
    for (const req of addon.requires ?? []) {
      if (!enabled.includes(req)) problems.push(`${addon.name} needs ${byId.get(req)?.name ?? req}`);
    }
    for (const other of addon.conflicts ?? []) {
      if (enabled.includes(other)) problems.push(`${addon.name} conflicts with ${byId.get(other)?.name ?? other}`);
    }
  }
  return problems;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(target: Obj, patch: Obj): void {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (isObj(current) && isObj(value)) deepMerge(current, value);
    else target[key] = structuredClone(value);
  }
}

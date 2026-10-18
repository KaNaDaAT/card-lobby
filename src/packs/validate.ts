/**
 * Pack validation, as listed in docs/PACK_FORMAT.md, "Validation". Packs are untrusted data
 * (custom packs come from other players), so every shape is checked before the engine sees
 * it. Errors name the file and the path, like
 * `pack.json: cards.crystal-bowl.onPlay[0]: unknown op "chooseplayer"`.
 */
import { checkSetup } from '../engine/index';
import { getOp, type ParamKind } from '../engine/ops';
import { ENGINE_VERSION } from '../engine/types';
import { matchesPlayers, resolveCount } from './count';
import { addonProblems, mergeAddons, MergeError } from './merge';
import { PACK_FORMAT, type Addon, type LoadedPack, type Pack } from './types';

export const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
const MAX_PLAYERS = 20;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ZONE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const VAR = /^[A-Za-z_]\w*$/;
const PLAYER_WORDS = ['self', 'next', 'previous', 'all', 'others'];

/** Lower-or-equal comparison of dotted versions like "0.1" and "0.10.2". */
export function versionAtMost(version: string, max: string): boolean {
  const a = version.split('.').map(Number);
  const b = max.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

export interface ValidateOptions {
  /** Names the file a path came from. Defaults to "pack.json". */
  fileOf?: (path: string) => string;
  /** Files present in the pack, for image checks. Omit to check only the file type. */
  files?: ReadonlySet<string>;
}

/** Validates a complete pack (addons already merged). Returns readable errors, empty when valid. */
export function validatePack(raw: unknown, opts: ValidateOptions = {}): string[] {
  return new PackChecker(opts).run(raw);
}

/**
 * Validates a pack with a set of addons: each addon's shape, requirements and conflicts, the
 * merge, and then the merged result. Paths in the merged result name the file they came from.
 */
export function validateSelection(lp: LoadedPack, enabled: readonly string[], files?: ReadonlySet<string>): string[] {
  const addonFiles = new Map(lp.addons.map((a, i) => [a.id, lp.pack.addons?.[i] ?? `addon ${a.id}`]));
  const errors: string[] = [];
  for (const addon of lp.addons) {
    if (enabled.includes(addon.id)) errors.push(...validateAddon(addon, addonFiles.get(addon.id)!, files));
  }
  errors.push(...addonProblems(lp.addons, enabled));
  if (errors.length) return errors;

  let merged: Pack;
  try {
    merged = mergeAddons(lp.pack, lp.addons, enabled);
  } catch (err) {
    if (err instanceof MergeError) return [`${addonFiles.get(err.addonId) ?? err.addonId}: ${err.detail}`];
    return [err instanceof Error ? err.message : String(err)];
  }

  // The last enabled addon to touch a card, option or the rules owns errors about it.
  const owner = new Map<string, string>();
  for (const addon of lp.addons) {
    if (!enabled.includes(addon.id)) continue;
    const file = addonFiles.get(addon.id)!;
    for (const c of addon.cards?.add ?? []) owner.set(`cards.${c.id}`, file);
    for (const id of Object.keys(addon.cards?.modify ?? {})) owner.set(`cards.${id}`, file);
    for (const o of addon.options?.add ?? []) owner.set(`options.${o.id}`, file);
    for (const id of Object.keys(addon.options?.modify ?? {})) owner.set(`options.${id}`, file);
    if (addon.rules) owner.set('rules', `pack.json and ${file}`);
    if (addon.players) owner.set('players', file);
  }
  const fileOf = (path: string) => {
    const key = /^(cards|options)\.[^.[]+/.exec(path)?.[0] ?? path.split(/[.[]/)[0]!;
    return owner.get(key) ?? 'pack.json';
  };
  return [...errors, ...validatePack(merged, { fileOf, files })];
}

/** Shape checks for an addon file. Deeper checks run on the merged pack. */
export function validateAddon(raw: unknown, file: string, files?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${file}: ${path}: ${msg}`);
  if (!isObj(raw)) return [`${file}: expected an object`];
  const a = raw as Partial<Addon> & Obj;
  if (a.format !== PACK_FORMAT) err('format', `must be ${PACK_FORMAT}`);
  if (!isStr(a.id) || !ID.test(a.id)) err('id', 'lowercase letters, digits and dashes');
  if (!isStr(a.name) || !a.name.trim()) err('name', 'missing');
  if (!isStr(a.description)) err('description', 'missing');
  if (a.image !== undefined) checkImage(a.image, 'image', err, files);
  for (const key of ['requires', 'conflicts'] as const) {
    if (a[key] !== undefined && !(Array.isArray(a[key]) && a[key]!.every(isStr))) err(key, 'expected a list of addon ids');
  }
  if (a.players !== undefined) {
    if (!isObj(a.players)) err('players', 'expected { min?, max? }');
    else for (const k of ['min', 'max'] as const) if (a.players[k] !== undefined && !isInt(a.players[k], 1)) err(`players.${k}`, 'expected a whole number of at least 1');
  }
  if (a.cards !== undefined) {
    if (!isObj(a.cards)) err('cards', 'expected { add?, remove?, modify? }');
    else {
      if (a.cards.add !== undefined && !Array.isArray(a.cards.add)) err('cards.add', 'expected a list of cards');
      if (a.cards.remove !== undefined && !(Array.isArray(a.cards.remove) && a.cards.remove.every(isStr))) err('cards.remove', 'expected a list of card ids');
      if (a.cards.modify !== undefined && !isObj(a.cards.modify)) err('cards.modify', 'expected an object of card ids');
      else for (const [id, patch] of Object.entries(a.cards.modify ?? {})) if (!isObj(patch)) err(`cards.modify.${id}`, 'expected an object');
    }
  }
  if (a.rules !== undefined && !isObj(a.rules)) err('rules', 'expected an object');
  if (a.options !== undefined) {
    if (!isObj(a.options)) err('options', 'expected { add?, modify? }');
    else {
      if (a.options.add !== undefined && !Array.isArray(a.options.add)) err('options.add', 'expected a list of options');
      if (a.options.modify !== undefined && !isObj(a.options.modify)) err('options.modify', 'expected an object of option ids');
    }
  }
  return errors;
}

function checkImage(path: unknown, at: string, err: (path: string, msg: string) => void, files?: ReadonlySet<string>): void {
  if (!isStr(path) || !path) return err(at, 'expected an image path');
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || /^[a-z]+:/i.test(path)) {
    return err(at, 'must be a relative path inside the pack');
  }
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_TYPES.includes(ext)) return err(at, `image type must be one of ${IMAGE_TYPES.join(', ')}`);
  if (files && !files.has(path)) err(at, `file "${path}" is missing`);
}

interface Scope {
  vars: Set<string>;
  setup: boolean;
}

class PackChecker {
  private errors: string[] = [];
  private pack!: Pack;
  private cardIds = new Set<string>();
  private optionIds = new Set<string>();

  constructor(private readonly opts: ValidateOptions) {}

  private err(path: string, msg: string): void {
    const file = this.opts.fileOf?.(path) ?? 'pack.json';
    this.errors.push(`${file}: ${path}: ${msg}`);
  }

  run(raw: unknown): string[] {
    if (!isObj(raw)) return ['pack.json: expected an object'];
    const p = raw as Obj;
    this.pack = raw as unknown as Pack;
    if (p.format !== PACK_FORMAT) this.err('format', `must be ${PACK_FORMAT}`);
    if (!isStr(p.id) || !ID.test(p.id)) this.err('id', 'lowercase letters, digits and dashes');
    for (const key of ['name', 'version'] as const) if (!isStr(p[key]) || !(p[key] as string).trim()) this.err(key, 'missing');
    if (!isStr(p.description)) this.err('description', 'missing');
    if (p.author !== undefined && !isStr(p.author)) this.err('author', 'expected text');
    if (!isStr(p.engine) || !/^\d+(\.\d+)*$/.test(p.engine)) this.err('engine', 'expected a version like "0.1"');
    else if (!versionAtMost(p.engine, ENGINE_VERSION)) this.err('engine', `needs engine ${p.engine}, this app runs ${ENGINE_VERSION}`);

    const players = p.players as Obj | undefined;
    const range = isObj(players) && isInt(players.min, 1) && isInt(players.max, 1) && players.min <= players.max && players.max <= MAX_PLAYERS;
    if (!range) this.err('players', `expected { min, max } with 1 <= min <= max <= ${MAX_PLAYERS}`);

    if (!isObj(p.art)) this.err('art', 'expected { cover, back }');
    else {
      checkImage(p.art.cover, 'art.cover', (a, m) => this.err(a, m), this.opts.files);
      checkImage(p.art.back, 'art.back', (a, m) => this.err(a, m), this.opts.files);
      if (p.art.accent !== undefined && !isStr(p.art.accent)) this.err('art.accent', 'expected a CSS color');
    }
    if (p.addons !== undefined && !(Array.isArray(p.addons) && p.addons.every((a) => isStr(a) && a.endsWith('.json')))) {
      this.err('addons', 'expected a list of .json paths');
    }

    // Cards and options first: rules and ops refer to them.
    if (!Array.isArray(p.cards) || !p.cards.length) this.err('cards', 'expected a non-empty list');
    else for (const c of p.cards) if (isObj(c) && isStr(c.id)) this.cardIds.add(c.id);
    if (p.options !== undefined && !Array.isArray(p.options)) this.err('options', 'expected a list');
    else for (const o of (p.options as unknown[] | undefined) ?? []) if (isObj(o) && isStr(o.id)) this.optionIds.add(o.id);

    const counts = range ? this.playerCounts() : [];
    this.checkOptions(counts);
    if (!isObj(p.rules)) this.err('rules', 'expected an object');
    else this.checkRules(p.rules, counts);
    if (Array.isArray(p.cards)) this.checkCards(p.cards, counts);

    // Only simulate setup when everything else holds, so the engine sees a sound pack.
    if (!this.errors.length) {
      for (const n of counts) {
        const problem = checkSetup(this.pack, n);
        if (problem) {
          this.err('rules.roundSetup', `with ${n} players: ${problem}`);
          break;
        }
      }
    }
    return this.errors;
  }

  private playerCounts(): number[] {
    const out: number[] = [];
    for (let n = this.pack.players.min; n <= this.pack.players.max; n++) out.push(n);
    return out;
  }

  private checkCount(count: unknown, path: string, counts: number[]): void {
    const shapeOk =
      isInt(count) ||
      (isObj(count) && typeof count.perPlayer === 'number' && (count.offset === undefined || typeof count.offset === 'number')) ||
      (isObj(count) && isObj(count.byPlayers) && Object.values(count.byPlayers).every((v) => isInt(v)));
    if (!shapeOk) return this.err(path, 'expected a number, { perPlayer, offset? } or { byPlayers }');
    for (const n of counts) {
      try {
        const value = resolveCount(count as never, n);
        if (!isInt(value)) return this.err(path, `gives ${value} with ${n} players, expected a whole number of at least 0`);
      } catch (e) {
        return this.err(path, e instanceof Error ? e.message : String(e));
      }
    }
  }

  private checkOptions(counts: number[]): void {
    const seen = new Set<string>();
    ((this.pack.options as unknown[] | undefined) ?? []).forEach((raw, i) => {
      if (!isObj(raw) || !isStr(raw.id)) return this.err(`options[${i}]`, 'expected an option with an id');
      const at = `options.${raw.id}`;
      if (seen.has(raw.id)) this.err(at, 'duplicate option id');
      seen.add(raw.id);
      if (!isStr(raw.label)) this.err(`${at}.label`, 'missing');
      switch (raw.type) {
        case 'select': {
          const choices = raw.choices;
          if (!Array.isArray(choices) || !choices.length || !choices.every((c) => isObj(c) && isStr(c.value) && isStr(c.label))) {
            this.err(`${at}.choices`, 'expected a list of { value, label }');
          } else if (!choices.some((c) => (c as Obj).value === raw.default)) {
            this.err(`${at}.default`, 'must be one of the choices');
          }
          break;
        }
        case 'number': {
          const min = raw.min ?? 1;
          const max = raw.max ?? 10;
          if (!isInt(min) || !isInt(max) || min > max) this.err(at, 'expected whole numbers with min <= max');
          if (typeof raw.default === 'number') {
            if (!isInt(raw.default) || raw.default < (min as number) || raw.default > (max as number)) this.err(`${at}.default`, 'must be between min and max');
          } else {
            this.checkCount(raw.default, `${at}.default`, counts);
          }
          break;
        }
        case 'toggle':
          if (typeof raw.default !== 'boolean') this.err(`${at}.default`, 'expected true or false');
          break;
        default:
          this.err(`${at}.type`, 'expected select, number or toggle');
      }
    });
  }

  private checkRules(r: Obj, counts: number[]): void {
    const zoneDefs = (key: 'zones' | 'playerZones', allowed: string[], needed: string[]) => {
      const zones = r[key];
      if (!isObj(zones)) return this.err(`rules.${key}`, 'expected an object');
      for (const [id, z] of Object.entries(zones)) {
        if (!ZONE_ID.test(id)) this.err(`rules.${key}.${id}`, 'zone ids are letters, digits, dashes and underscores');
        if (!isObj(z) || !allowed.includes(z.visibility as string)) this.err(`rules.${key}.${id}.visibility`, `expected ${allowed.join(' or ')}`);
        else if (z.label !== undefined && !isStr(z.label)) this.err(`rules.${key}.${id}.label`, 'expected text');
      }
      for (const id of needed) if (!(id in zones)) this.err(`rules.${key}`, `the engine needs a "${id}" zone`);
    };
    zoneDefs('zones', ['public', 'hidden'], ['deck']);
    zoneDefs('playerZones', ['public', 'owner'], ['hand', 'played']);
    for (const id of Object.keys(isObj(r.zones) ? r.zones : {})) {
      if (isObj(r.playerZones) && id in r.playerZones) this.err(`rules.zones.${id}`, 'is also a player zone');
    }

    if (r.statuses !== undefined) {
      if (!isObj(r.statuses)) this.err('rules.statuses', 'expected an object');
      else for (const [id, st] of Object.entries(r.statuses)) {
        if (!isObj(st) || !isStr(st.label)) this.err(`rules.statuses.${id}.label`, 'missing');
        else if (st.untargetable !== undefined && typeof st.untargetable !== 'boolean') this.err(`rules.statuses.${id}.untargetable`, 'expected true or false');
      }
    }

    this.checkOps(r.roundSetup, 'rules.roundSetup', { vars: new Set(), setup: true });
    if (!Array.isArray(r.turn) || !r.turn.length) this.err('rules.turn', 'expected a non-empty list of ops');
    else this.checkOps(r.turn, 'rules.turn', { vars: new Set(), setup: false });

    if (r.roundEnd !== undefined && !(isObj(r.roundEnd) && (r.roundEnd.lastStanding === undefined || typeof r.roundEnd.lastStanding === 'boolean'))) {
      this.err('rules.roundEnd', 'expected { lastStanding? }');
    }
    if (r.showdown !== undefined) {
      if (!isObj(r.showdown)) this.err('rules.showdown', 'expected an object');
      else {
        const tieBreaks = ['highestPlayed', 'sumPlayed', 'none'];
        const tb = r.showdown.tieBreak;
        if (isObj(tb)) {
          const def = this.pack.options?.find((o) => o.id === tb.option);
          if (!def) this.err('rules.showdown.tieBreak', `no option "${String(tb.option)}"`);
          else if (def.type !== 'select' || !def.choices.every((c) => tieBreaks.includes(c.value))) {
            this.err('rules.showdown.tieBreak', `option "${def.id}" must be a select of ${tieBreaks.join(', ')}`);
          }
        } else if (tb !== undefined && !tieBreaks.includes(tb as string)) {
          this.err('rules.showdown.tieBreak', `expected ${tieBreaks.join(', ')} or an option`);
        }
        if (r.showdown.stillTied !== undefined && r.showdown.stillTied !== 'allWin') this.err('rules.showdown.stillTied', 'expected allWin');
      }
    }

    const scoring = r.scoring;
    if (!isObj(scoring)) this.err('rules.scoring', 'expected an object');
    else {
      if (!isInt(scoring.roundWin)) this.err('rules.scoring.roundWin', 'expected a whole number');
      const toWin = scoring.toWin;
      if (isObj(toWin) && 'option' in toWin) {
        const def = this.pack.options?.find((o) => o.id === toWin.option);
        if (!def || def.type !== 'number') this.err('rules.scoring.toWin', `no number option "${String(toWin.option)}"`);
      } else {
        this.checkCount(toWin, 'rules.scoring.toWin', counts);
      }
      if (scoring.tiedAtTarget !== undefined && !['decidingRound', 'allWin'].includes(scoring.tiedAtTarget as string)) {
        this.err('rules.scoring.tiedAtTarget', 'expected decidingRound or allWin');
      }
    }

    if (r.rounds !== undefined) {
      if (!isObj(r.rounds)) this.err('rules.rounds', 'expected an object');
      else {
        if (r.rounds.first !== undefined && !['random', 'nextSeat'].includes(r.rounds.first as string)) this.err('rules.rounds.first', 'expected random or nextSeat');
        if (r.rounds.next !== undefined && !['lastWinner', 'nextSeat', 'random'].includes(r.rounds.next as string)) this.err('rules.rounds.next', 'expected lastWinner, nextSeat or random');
      }
    }
  }

  private checkCards(cards: unknown[], counts: number[]): void {
    const known = ['id', 'name', 'value', 'count', 'text', 'image', 'tags', 'onPlay', 'onDiscard', 'onDraw', 'showdownValue'];
    const seen = new Set<string>();
    cards.forEach((raw, i) => {
      if (!isObj(raw) || !isStr(raw.id) || !raw.id) return this.err(`cards[${i}]`, 'expected a card with an id');
      const at = `cards.${raw.id}`;
      if (seen.has(raw.id)) this.err(at, 'duplicate card id');
      seen.add(raw.id);
      for (const key of Object.keys(raw)) if (!known.includes(key)) this.err(`${at}.${key}`, 'unknown field');
      if (!isStr(raw.name) || !raw.name.trim()) this.err(`${at}.name`, 'missing');
      if (!isStr(raw.text)) this.err(`${at}.text`, 'missing');
      if (raw.value !== undefined && !Number.isFinite(raw.value)) this.err(`${at}.value`, 'expected a number');
      this.checkCount(raw.count, `${at}.count`, counts);
      if (raw.image !== undefined) checkImage(raw.image, `${at}.image`, (a, m) => this.err(a, m), this.opts.files);
      if (raw.tags !== undefined && !(Array.isArray(raw.tags) && raw.tags.every(isStr))) this.err(`${at}.tags`, 'expected a list of words');
      for (const hook of ['onPlay', 'onDiscard'] as const) {
        if (raw[hook] !== undefined) this.checkOps(raw[hook], `${at}.${hook}`, { vars: new Set(), setup: false });
      }
      if (raw.onDraw !== undefined) this.err(`${at}.onDraw`, 'onDraw is planned but not supported by this engine yet');
      if (raw.showdownValue !== undefined) {
        if (!Array.isArray(raw.showdownValue)) this.err(`${at}.showdownValue`, 'expected a list of { if, value }');
        else raw.showdownValue.forEach((rule, j) => {
          const path = `${at}.showdownValue[${j}]`;
          if (!isObj(rule)) return this.err(path, 'expected { if, value }');
          this.checkCond(rule.if, `${path}.if`, { vars: new Set(), setup: false });
          if (!(Number.isFinite(rule.value) || rule.value === 'highest' || rule.value === 'lowest')) {
            this.err(`${path}.value`, 'expected a number, "highest" or "lowest"');
          }
        });
      }
    });
    for (const n of counts) {
      const total = cards.reduce<number>((sum, c) => {
        try {
          return sum + (isObj(c) ? resolveCount(c.count as never, n) : 0);
        } catch {
          return sum;
        }
      }, 0);
      if (total <= 0) {
        this.err('cards', `the deck is empty with ${n} players`);
        break;
      }
    }
  }

  private checkOps(ops: unknown, path: string, scope: Scope): void {
    if (!Array.isArray(ops)) return this.err(path, 'expected a list of ops');
    ops.forEach((op, i) => {
      const at = `${path}[${i}]`;
      if (!isObj(op) || !isStr(op.op)) return this.err(at, 'expected an op like { "op": "draw", ... }');
      const def = getOp(op.op);
      if (!def) return this.err(at, `unknown op "${op.op}"`);
      if (def.status === 'future') return this.err(at, `op "${op.op}" is planned but not supported by this engine yet`);
      if (scope.setup && def.asks) this.err(at, `"${op.op}" asks a player, which roundSetup cannot do`);
      for (const key of def.required) if (!(key in op)) this.err(at, `"${op.op}" needs "${key}"`);
      for (const key of Object.keys(op)) if (key !== 'op' && !(key in def.params)) this.err(`${at}.${key}`, `"${op.op}" has no param "${key}"`);

      if (op.op === 'if') {
        this.checkCond(op.cond, `${at}.cond`, scope);
        const thenScope = { ...scope, vars: new Set(scope.vars) };
        const elseScope = { ...scope, vars: new Set(scope.vars) };
        if (op.then !== undefined) this.checkOps(op.then, `${at}.then`, thenScope);
        if (op.else !== undefined) this.checkOps(op.else, `${at}.else`, elseScope);
        // Variables set in either branch may be set afterwards. `set` conditions test that.
        for (const v of [...thenScope.vars, ...elseScope.vars]) scope.vars.add(v);
        return;
      }
      for (const [key, kind] of Object.entries(def.params)) {
        if (key in op && kind !== 'as') this.checkParam(kind, op[key], `${at}.${key}`, scope);
      }
      if ('as' in op) {
        if (!isStr(op.as) || !VAR.test(op.as) || op.as === 'self') this.err(`${at}.as`, 'expected a variable name like "t"');
        else scope.vars.add(op.as);
      }
    });
  }

  private checkVar(ref: string, path: string, scope: Scope): void {
    const name = ref.slice(1);
    if (!scope.vars.has(name)) this.err(path, `variable "${ref}" is not set by an earlier op`);
  }

  private checkPlayers(ref: unknown, path: string, scope: Scope, single = false): void {
    if (!isStr(ref)) return this.err(path, 'expected a player reference');
    if (ref.startsWith('$')) return this.checkVar(ref, path, scope);
    if (!PLAYER_WORDS.includes(ref)) return this.err(path, `expected ${PLAYER_WORDS.join(', ')} or a $variable`);
    if (single && (ref === 'all' || ref === 'others')) this.err(path, `"${ref}" names several players, one is needed here`);
  }

  private checkZone(ref: unknown, path: string, scope: Scope, single: boolean): void {
    if (!isStr(ref)) return this.err(path, 'expected a zone');
    const colon = ref.indexOf(':');
    if (colon < 0) {
      if (!isObj(this.pack.rules.zones) || !Object.hasOwn(this.pack.rules.zones, ref)) this.err(path, `no zone "${ref}"`);
      return;
    }
    const kind = ref.slice(0, colon);
    if (!isObj(this.pack.rules.playerZones) || !Object.hasOwn(this.pack.rules.playerZones, kind)) this.err(path, `no player zone "${kind}"`);
    this.checkPlayers(ref.slice(colon + 1), path, scope, single);
  }

  private checkValue(ref: unknown, path: string, scope: Scope): void {
    if (typeof ref === 'number') return;
    if (isStr(ref) && ref.startsWith('$')) return this.checkVar(ref, path, scope);
    if (isObj(ref) && isStr(ref.option)) {
      if (!this.optionIds.has(ref.option)) this.err(path, `no option "${ref.option}"`);
      return;
    }
    this.err(path, 'expected a number, a $variable or { "option": id }');
  }

  private checkParam(kind: ParamKind, v: unknown, path: string, scope: Scope): void {
    switch (kind) {
      case 'players':
        return this.checkPlayers(v, path, scope);
      case 'zone':
        return this.checkZone(v, path, scope, true);
      case 'zones':
        return this.checkZone(v, path, scope, false);
      case 'var':
        if (!isStr(v) || !v.startsWith('$')) return this.err(path, 'expected a $variable');
        return this.checkVar(v, path, scope);
      case 'count':
        if (v !== 'all' && !isInt(v, 1)) this.err(path, 'expected a whole number of at least 1, or "all"');
        return;
      case 'int':
        if (!isInt(v)) this.err(path, 'expected a whole number');
        return;
      case 'bool':
        if (typeof v !== 'boolean') this.err(path, 'expected true or false');
        return;
      case 'at':
        if (isStr(v) && v.startsWith('$')) return this.checkVar(v, path, scope);
        if (!['top', 'bottom', 'random'].includes(v as string)) this.err(path, 'expected top, bottom, random or a $variable');
        return;
      case 'cardId':
        if (!isStr(v) || !this.cardIds.has(v)) this.err(path, `no card "${String(v)}"`);
        return;
      case 'status':
        if (!isStr(v) || !isObj(this.pack.rules.statuses) || !Object.hasOwn(this.pack.rules.statuses, v)) this.err(path, `no status "${String(v)}"`);
        return;
      case 'until':
        if (!['ownNextTurn', 'endOfTurn', 'endOfRound', 'permanent'].includes(v as string)) this.err(path, 'expected ownNextTurn, endOfTurn, endOfRound or permanent');
        return;
      case 'text':
        if (!isStr(v)) return this.err(path, 'expected text');
        for (const [, ref] of v.matchAll(/\{(\$\w+)\}/g)) this.checkVar(ref!, path, scope);
        return;
      case 'values':
        if (!Array.isArray(v) || !v.every((x) => Number.isFinite(x))) this.err(path, 'expected a list of numbers');
        return;
      case 'ops':
        return this.checkOps(v, path, scope);
      case 'cond':
        return this.checkCond(v, path, scope);
      case 'by':
        if (v !== 'showdown') this.err(path, 'expected showdown');
        return;
      case 'audience':
        if (v !== 'all') this.checkPlayers(v, path, scope);
        return;
      case 'as':
        return;
    }
  }

  private checkCond(c: unknown, path: string, scope: Scope): void {
    if (!isObj(c) || Object.keys(c).length !== 1) return this.err(path, 'expected a condition with exactly one key');
    const [key, v] = Object.entries(c)[0]!;
    switch (key) {
      case 'players':
        try {
          if (!isStr(v)) throw new Error('expected a player range like "2" or "4-6"');
          matchesPlayers(v, 2);
        } catch (e) {
          this.err(`${path}.players`, e instanceof Error ? e.message : String(e));
        }
        return;
      case 'zoneEmpty':
        return this.checkZone(v, `${path}.zoneEmpty`, scope, false);
      case 'set':
      case 'is':
        if (!isStr(v) || !v.startsWith('$')) return this.err(`${path}.${key}`, 'expected a $variable');
        return this.checkVar(v, `${path}.${key}`, scope);
      case 'in':
        return this.checkPlayers(v, `${path}.in`, scope);
      case 'handHasValue':
        if (!Array.isArray(v) || v.length !== 2) return this.err(`${path}.handHasValue`, 'expected [player, value]');
        this.checkPlayers(v[0], `${path}.handHasValue[0]`, scope, true);
        return this.checkValue(v[1], `${path}.handHasValue[1]`, scope);
      case 'anyHandHas':
        if (!isStr(v) || !this.cardIds.has(v)) this.err(`${path}.anyHandHas`, `no card "${String(v)}"`);
        return;
      case 'not':
        return this.checkCond(v, `${path}.not`, scope);
      case 'all':
      case 'any':
        if (!Array.isArray(v)) return this.err(`${path}.${key}`, 'expected a list of conditions');
        v.forEach((sub, i) => this.checkCond(sub, `${path}.${key}[${i}]`, scope));
        return;
      default:
        this.err(path, `unknown condition "${key}"`);
    }
  }
}

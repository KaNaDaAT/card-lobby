/**
 * Custom pack pieces: the host's upload tile (a zip is a game or an addon for a game), and the
 * consent card players see before anything from the host is downloaded. See docs/DESIGN.md,
 * "Custom packs".
 */
import type { LobbyView, PackStatus } from '../../net/protocol';
import { cachePack, forgetPack } from '../../packs/cache';
import { importZip, MAX_PACK_BYTES, mb, PackImportError } from '../../packs/custom';
import type { LoadedAddon, LoadedPack, PackOffer } from '../../packs/types';
import type { PackOfferState } from '../../session/types';
import type { RoomCtx } from '../screens/lobby';
import { h, type Child } from '../dom';

const TRUST_NOTE = 'Only accept packs from people you trust. A pack can contain any images and text.';

/** The gallery tile that takes a .zip, with any problems the last upload had. */
export function uploadTile(ctx: RoomCtx): Child[] {
  const busy = ctx.upload.busy;
  const input = h('input', {
    type: 'file',
    accept: '.zip,application/zip',
    class: 'visually-hidden',
    'aria-label': 'Upload a custom game or addon (.zip)',
    disabled: busy,
    onchange: (e: Event) => {
      const el = e.target as HTMLInputElement;
      const file = el.files?.[0];
      el.value = '';
      if (file) void uploadPack(ctx, file);
    },
  });
  return [
    h(
      'label',
      { class: `tile tile-custom${busy ? ' is-busy' : ''}` },
      input,
      h('span', { class: 'tile-img tile-plus', 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'tile-body' },
        h('span', { class: 'tile-name' }, 'Custom pack'),
        h('span', { class: 'tile-meta' }, busy ? 'Checking the zip...' : 'Upload a game or addon .zip'),
      ),
    ),
  ];
}

export function uploadProblems(ctx: RoomCtx): Child {
  const problems = ctx.upload.problems;
  if (!problems.length) return null;
  const shown = problems.slice(0, 8);
  return h(
    'div',
    { class: 'upload-problems', role: 'alert' },
    h('strong', null, 'That zip cannot be used.'),
    h('ul', null, shown.map((p) => h('li', null, p))),
    problems.length > shown.length ? h('p', { class: 'muted small' }, `And ${problems.length - shown.length} more.`) : null,
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ((ctx.upload = { busy: false, problems: [] }), ctx.redraw()) }, 'Dismiss'),
  );
}

/** A game zip joins the gallery and is picked. An addon zip joins its game, which is picked, and turns on. */
async function uploadPack(ctx: RoomCtx, file: File): Promise<void> {
  const host = ctx.host;
  if (!host) return;
  ctx.upload = { busy: true, problems: [] };
  ctx.redraw();
  try {
    if (file.size > MAX_PACK_BYTES) throw new PackImportError([`The zip is bigger than the ${mb(MAX_PACK_BYTES)} limit.`]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const item = await importZip(bytes);
    if (item.kind === 'game') {
      host.addPack(item.pack);
      await cachePack(item.pack.custom!.offer.hash, item.pack.pack.name, bytes);
      ctx.session.act({ kind: 'selectPack', packId: item.pack.key });
    } else {
      const problems = host.addAddon(item.addon);
      if (problems.length) throw new PackImportError(problems);
      await cachePack(item.addon.custom.offer.hash, item.addon.addon.name, bytes);
      const lobby = ctx.session.state().view?.lobby;
      const game = host.availablePacks().find((p) => p.key === lobby?.packId && p.pack.id === item.addon.gameId) ?? host.availablePacks().find((p) => p.pack.id === item.addon.gameId);
      if (game && game.key !== lobby?.packId) ctx.session.act({ kind: 'selectPack', packId: game.key });
      ctx.session.act({ kind: 'toggleAddon', addonId: item.addon.addon.id, on: true });
    }
    ctx.upload = { busy: false, problems: [] };
  } catch (err) {
    ctx.upload = { busy: false, problems: err instanceof PackImportError ? err.problems : [String(err)] };
  }
  ctx.redraw();
}

/** Takes an uploaded pack out of the gallery and out of this browser's cache. */
export function removeUpload(ctx: RoomCtx, lp: LoadedPack): void {
  if (!ctx.host?.removePack(lp.key) || !lp.custom) return;
  void forgetPack(lp.custom.offer.hash);
  ctx.redraw();
}

/** Takes an uploaded addon away from its game and out of this browser's cache. */
export function removeAddonUpload(ctx: RoomCtx, upload: LoadedAddon): void {
  if (!ctx.host?.removeAddon(upload.key)) return;
  void forgetPack(upload.custom.offer.hash);
  ctx.redraw();
}

/** What a player sees until everything custom the host uses is loaded on their page. */
export function packConsent(ctx: RoomCtx, lobby: LobbyView): HTMLElement {
  const files = [...(lobby.customPack ? [lobby.customPack] : []), ...lobby.customAddons];
  const states = ctx.session.state().packOffers;
  const stateOf = (o: PackOffer): PackOfferState => states.find((s) => s.offer.hash === o.hash) ?? { offer: o, status: 'checking', progress: 0 };
  const all = files.map(stateOf);
  const has = (...status: PackOfferState['status'][]) => all.some((s) => status.includes(s.status));
  const answer = (accept: boolean) => ctx.session.answerPackOffer(accept);
  const gameName = (id: string | undefined) => ctx.packs.find((p) => p.pack.id === id)?.pack.name ?? lobby.customPack?.name ?? id ?? 'the game';
  const many = files.length > 1;

  const facts = h(
    'dl',
    { class: 'pack-facts' },
    files.map((offer) => [
      h('dt', null, offer.kind === 'game' ? 'Game' : `Addon for ${gameName(offer.extends)}`),
      h(
        'dd',
        null,
        h('strong', null, offer.name),
        offer.author ? ` by ${offer.author}` : '',
        h('span', { class: 'muted small' }, ` (${mb(offer.bytes)}, ${offer.images} ${offer.images === 1 ? 'image' : 'images'})`),
      ),
    ]),
  );

  const it = many ? 'them' : 'it';
  let body: Child;
  if (has('asking')) {
    body = [
      h('p', { class: 'pack-note' }, TRUST_NOTE),
      h(
        'div',
        { class: 'result-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => answer(true) }, many ? 'Get them' : 'Get the pack'),
        h('button', { type: 'button', class: 'btn', onclick: () => answer(false) }, 'No thanks, I will watch'),
      ),
    ];
  } else if (has('failed')) {
    const failed = all.find((s) => s.status === 'failed')!;
    body = [
      h('p', { class: 'form-error' }, `${failed.offer.name} did not load: ${failed.error ?? 'unknown problem'}`),
      h('button', { type: 'button', class: 'btn', onclick: () => answer(true) }, 'Try again'),
    ];
  } else if (has('queued', 'downloading', 'loading')) {
    const done = all.filter((s) => s.status === 'ready').length;
    const current = all.find((s) => s.status === 'downloading' || s.status === 'loading');
    const pct = Math.round(((done + (current?.status === 'loading' ? 1 : (current?.progress ?? 0))) / all.length) * 100);
    body = [
      h('progress', { class: 'pack-progress', max: 100, value: pct, 'aria-label': 'Download progress' }),
      h('p', { class: 'muted small' }, current?.status === 'loading' ? `Checking ${current.offer.name}...` : current ? `Downloading ${current.offer.name}, ${pct}%` : 'Downloading...'),
    ];
  } else if (has('declined')) {
    body = [
      h('p', null, 'You are watching this game. Changed your mind?'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => answer(true) }, many ? 'Get them' : 'Get the pack'),
    ];
  } else if (has('checking')) {
    body = h('div', { class: 'pack-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'muted' }, `Looking for ${it} on this device...`));
  } else {
    body = h('p', { class: 'muted' }, 'Loading...');
  }
  const title = lobby.customPack ? 'The host picked a custom game' : many ? 'The host added custom addons' : 'The host added a custom addon';
  return h('section', { class: 'panel pack-consent' }, h('h2', null, title), facts, body);
}

const PACK_BADGE: Partial<Record<PackStatus, string>> = {
  offered: 'Deciding on pack',
  downloading: 'Getting pack',
  declined: 'Declined pack',
  failed: 'Pack failed',
};

export function packBadge(status: PackStatus): Child {
  const text = PACK_BADGE[status];
  return text ? h('span', { class: `badge badge-soft${status === 'failed' ? ' badge-bad' : ''}` }, text) : null;
}

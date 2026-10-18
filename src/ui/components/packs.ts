/**
 * Custom pack pieces: the host's upload tile, and the consent card players see before a pack
 * from the host is downloaded. See docs/DESIGN.md, "Custom packs".
 */
import type { LobbyView, PackStatus } from '../../net/protocol';
import { cachePack, forgetPack } from '../../packs/cache';
import { importPackZip, MAX_PACK_BYTES, mb, PackImportError } from '../../packs/custom';
import type { LoadedPack } from '../../packs/types';
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
    'aria-label': 'Upload a custom pack (.zip)',
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
        h('span', { class: 'tile-meta' }, busy ? 'Checking the pack...' : 'Upload a .zip'),
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
    h('strong', null, 'That pack cannot be used.'),
    h('ul', null, shown.map((p) => h('li', null, p))),
    problems.length > shown.length ? h('p', { class: 'muted small' }, `And ${problems.length - shown.length} more.`) : null,
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ((ctx.upload = { busy: false, problems: [] }), ctx.redraw()) }, 'Dismiss'),
  );
}

async function uploadPack(ctx: RoomCtx, file: File): Promise<void> {
  if (!ctx.host) return;
  ctx.upload = { busy: true, problems: [] };
  ctx.redraw();
  try {
    if (file.size > MAX_PACK_BYTES) throw new PackImportError([`The pack is bigger than the ${mb(MAX_PACK_BYTES)} limit.`]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lp = await importPackZip(bytes);
    await cachePack(lp.custom!.offer.hash, lp.pack.name, bytes);
    ctx.host.addPack(lp);
    ctx.session.act({ kind: 'selectPack', packId: lp.key });
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

/** What a player sees until the host's custom pack is loaded on their page. */
export function packConsent(ctx: RoomCtx, lobby: LobbyView): HTMLElement {
  const offer = lobby.customPack!;
  const state = ctx.session.state().packOffer;
  const status = state?.offer.hash === offer.hash ? state.status : 'checking';
  const answer = (accept: boolean) => ctx.session.answerPackOffer(accept);

  const facts = h(
    'dl',
    { class: 'pack-facts' },
    h('dt', null, 'Game'),
    h('dd', null, offer.name),
    offer.author ? [h('dt', null, 'By'), h('dd', null, offer.author)] : null,
    h('dt', null, 'Size'),
    h('dd', null, `${mb(offer.bytes)}, ${offer.images} ${offer.images === 1 ? 'image' : 'images'}`),
  );

  let body: Child;
  switch (status) {
    case 'checking':
      body = h('div', { class: 'pack-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'muted' }, 'Looking for the pack on this device...'));
      break;
    case 'asking':
      body = [
        h('p', { class: 'pack-note' }, TRUST_NOTE),
        h(
          'div',
          { class: 'result-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => answer(true) }, 'Get the pack'),
          h('button', { type: 'button', class: 'btn', onclick: () => answer(false) }, 'No thanks, I will watch'),
        ),
      ];
      break;
    case 'downloading': {
      const pct = Math.round((state?.progress ?? 0) * 100);
      body = [
        h('progress', { class: 'pack-progress', max: 100, value: pct, 'aria-label': 'Download progress' }),
        h('p', { class: 'muted small' }, pct > 0 ? `Downloading, ${pct}%` : 'Downloading...'),
      ];
      break;
    }
    case 'loading':
      body = h('div', { class: 'pack-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'muted' }, 'Checking the pack...'));
      break;
    case 'declined':
      body = [
        h('p', null, 'You are watching this game. Changed your mind?'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => answer(true) }, 'Get the pack'),
      ];
      break;
    case 'failed':
      body = [
        h('p', { class: 'form-error' }, `The pack did not load: ${state?.error ?? 'unknown problem'}`),
        h('button', { type: 'button', class: 'btn', onclick: () => answer(true) }, 'Try again'),
      ];
      break;
    case 'ready':
      body = h('p', { class: 'muted' }, 'Loading the pack...');
      break;
  }
  return h('section', { class: 'panel pack-consent' }, h('h2', null, 'The host picked a custom game'), facts, body);
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

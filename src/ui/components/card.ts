import type { CardDef, LoadedPack } from '../../packs/types';
import { h } from '../dom';

/** A card face: the pack's art with value and name drawn on top. */
export function cardFace(lp: LoadedPack, card: CardDef, opts: { count?: number } = {}): HTMLElement {
  return h(
    'div',
    { class: 'card', title: `${card.name}: ${card.text}` },
    card.image ? h('img', { src: lp.asset(card.image), alt: '', loading: 'lazy', draggable: 'false' }) : null,
    card.value !== undefined ? h('span', { class: 'card-value' }, card.value) : null,
    opts.count !== undefined && opts.count > 1 ? h('span', { class: 'card-count' }, `x${opts.count}`) : null,
    h('span', { class: 'card-name' }, card.name),
  );
}

export function cardBack(lp: LoadedPack): HTMLElement {
  return h('div', { class: 'card card-back' }, h('img', { src: lp.asset(lp.pack.art.back), alt: '', draggable: 'false' }));
}

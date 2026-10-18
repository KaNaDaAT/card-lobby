import { valueText, type CardDef, type LoadedPack } from '../../packs/types';
import { h } from '../dom';

export interface CardOpts {
  /** "x3" badge in the lobby's card list. */
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Makes the card a button. Without it, clicking shows the card large with its text. */
  onClick?: () => void;
  /** Highlights a card that can be played or picked. */
  active?: boolean;
  disabled?: boolean;
  /** Plays the enter animation (a card that just arrived). */
  enter?: boolean;
  /** Small corner note, like a position in the draw pile. */
  note?: string;
}

function classes(base: string, opts: CardOpts): string {
  return [
    base,
    opts.size ? `card-${opts.size}` : '',
    opts.active ? 'is-active' : '',
    opts.enter ? 'card-enter' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A card face: the pack's art with value and name drawn on top. */
export function cardFace(lp: LoadedPack, card: CardDef, opts: CardOpts = {}): HTMLElement {
  const parts = [
    card.image ? h('img', { src: lp.asset(card.image), alt: '', loading: 'lazy', draggable: 'false' }) : null,
    card.value !== undefined ? h('span', { class: 'card-value' }, valueText(card)) : null,
    opts.count !== undefined && opts.count > 1 ? h('span', { class: 'card-count' }, `x${opts.count}`) : null,
    opts.note ? h('span', { class: 'card-note' }, opts.note) : null,
    h('span', { class: 'card-name' }, card.name),
  ];
  const label = `${card.name}${card.value !== undefined ? ` (${valueText(card)})` : ''}: ${card.text}`;
  if (opts.onClick) {
    return h('button', { type: 'button', class: classes('card card-button', opts), title: label, 'aria-label': label, disabled: opts.disabled, onclick: opts.onClick }, parts);
  }
  return h(
    'button',
    { type: 'button', class: classes('card card-button card-inspect', opts), title: label, 'aria-label': label, onclick: () => showCard(lp, card) },
    parts,
  );
}

export function cardBack(lp: LoadedPack, opts: CardOpts = {}): HTMLElement {
  return h(
    'div',
    { class: classes('card card-back', opts), 'aria-label': 'Face-down card' },
    h('img', { src: lp.asset(lp.pack.art.back), alt: '', draggable: 'false' }),
    opts.note ? h('span', { class: 'card-note' }, opts.note) : null,
  );
}

export interface CardAction {
  label: string;
  /** `danger` for a play that costs you, like the King Cat. */
  kind?: 'primary' | 'danger';
  onClick: () => void;
}

/** Shows one card large, with its rules text. With an action (Play), the other button is Back. */
export function showCard(lp: LoadedPack, card: CardDef, opts: { actions?: CardAction[]; note?: string } = {}): void {
  const actions = opts.actions ?? [];
  const danger = actions.some((a) => a.kind === 'danger');
  const dialog = h(
    'dialog',
    { class: 'card-dialog', 'aria-label': card.name },
    h(
      'div',
      { class: 'card-dialog-body' },
      h('div', { class: 'card card-xl' }, [
        card.image ? h('img', { src: lp.asset(card.image), alt: '', draggable: 'false' }) : null,
        card.value !== undefined ? h('span', { class: 'card-value' }, valueText(card)) : null,
        h('span', { class: 'card-name' }, card.name),
      ]),
      h(
        'div',
        { class: 'card-dialog-text' },
        h('h2', null, card.name),
        card.value !== undefined ? h('p', { class: 'muted' }, `Value ${valueText(card)}`) : null,
        h('p', null, card.text),
        opts.note ? h('p', { class: 'card-dialog-note' }, opts.note) : null,
        h(
          'div',
          { class: 'card-dialog-actions' },
          actions.map((a) =>
            h(
              'button',
              {
                type: 'button',
                class: `btn card-play ${a.kind === 'danger' ? 'btn-danger' : 'btn-primary'}`,
                autofocus: !danger,
                onclick: () => {
                  dialog.close();
                  a.onClick();
                },
              },
              a.label,
            ),
          ),
          // A plain button: the page's CSP (form-action 'none') may block <form method="dialog">.
          h('button', { type: 'button', class: 'btn', autofocus: danger || !actions.length, onclick: () => dialog.close() }, actions.length ? 'Back' : 'Close'),
        ),
      ),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

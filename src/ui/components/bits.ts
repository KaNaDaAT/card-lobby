import { safeColor } from '../../identity';
import { h, type Child } from '../dom';

export function brandMark(size?: 'sm'): HTMLElement {
  return h('span', { class: `brand-mark${size ? ` ${size}` : ''}`, 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
}

export function avatar(name: string, color: string, size?: 'lg'): HTMLElement {
  return h(
    'span',
    { class: `avatar${size ? ` avatar-${size}` : ''}`, style: `--c: ${safeColor(color)}`, 'aria-hidden': 'true' },
    name.trim().charAt(0).toUpperCase() || '?',
  );
}

export function pill(text: string, cls = ''): HTMLElement {
  return h('span', { class: `pill${cls ? ` ${cls}` : ''}` }, text);
}

export function section(title: string, ...body: Child[]): HTMLElement {
  return h('section', { class: 'detail-section' }, h('h3', null, title), ...body);
}

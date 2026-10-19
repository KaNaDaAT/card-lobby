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

/** A small line icon from SVG path data, drawn in the current text color. Our own markup only. */
export function icon(paths: string[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function section(title: string, ...body: Child[]): HTMLElement {
  return h('section', { class: 'detail-section' }, h('h3', null, title), ...body);
}

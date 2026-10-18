import { parseCode } from '../net/code';

/** Hash routes. The room code lives after `#`, so it never reaches any server. */
export type Route = { name: 'home' } | { name: 'room'; code: string };

/** A screen draws into `root` and may return a cleanup function. */
export type Screen<R extends Route = Route> = (root: HTMLElement, route: R) => void | (() => void);

export function parseRoute(hash: string): Route {
  const m = /^#\/r\/([^/?#]+)/.exec(hash);
  const code = m ? parseCode(decodeURIComponent(m[1]!)) : null;
  return code ? { name: 'room', code } : { name: 'home' };
}

export function routeHash(route: Route): string {
  return route.name === 'room' ? `#/r/${route.code}` : '#/';
}

export function navigate(route: Route): void {
  location.hash = routeHash(route);
}

/**
 * Shareable link to a room, without dev-only query params like `?as=`. Local mode keeps
 * `?transport=local`, since a tab without it would look for the room on the network.
 */
export function roomLink(code: string, opts: { local?: boolean } = {}): string {
  const query = opts.local ? '?transport=local' : '';
  return `${location.origin}${location.pathname}${query}${routeHash({ name: 'room', code })}`;
}

export function startRouter(
  root: HTMLElement,
  screens: { home: Screen<{ name: 'home' }>; room: Screen<{ name: 'room'; code: string }> },
): void {
  let cleanup: (() => void) | void;
  const render = () => {
    cleanup?.();
    root.replaceChildren();
    const route = parseRoute(location.hash);
    cleanup = route.name === 'room' ? screens.room(root, route) : screens.home(root, route);
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', render);
  render();
}

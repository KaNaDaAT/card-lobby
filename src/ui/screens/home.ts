import { loadIdentity, markHosting, PLAYER_COLORS, saveIdentity } from '../../identity';
import { CODE_LENGTH, formatCode, generateCode, parseCode } from '../../net/code';
import { h } from '../dom';
import { navigate, type Screen } from '../router';

/** Accepts a bare code or a pasted room link. */
function codeFromInput(raw: string): string | null {
  const fromLink = /#\/r\/([^/?#\s]+)/.exec(raw);
  return parseCode(fromLink ? decodeURIComponent(fromLink[1]!) : raw);
}

export const renderHome: Screen<{ name: 'home' }> = (root) => {
  const me = loadIdentity();
  let color = me.color;

  const error = h('p', { class: 'form-error', role: 'alert' });
  const showError = (text: string) => (error.textContent = text);

  const nameInput = h('input', {
    id: 'name',
    class: 'input',
    maxlength: 24,
    value: me.name,
    autocomplete: 'nickname',
    spellcheck: 'false',
  });

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Color' });
  const drawSwatches = () =>
    swatches.replaceChildren(
      ...PLAYER_COLORS.map((c) =>
        h('button', {
          type: 'button',
          class: 'swatch',
          style: `--swatch: ${c}`,
          role: 'radio',
          'aria-checked': String(c === color),
          'aria-label': c,
          onclick: () => {
            color = c;
            drawSwatches();
          },
        }),
      ),
    );
  drawSwatches();

  /** Saves name and color. Returns false and shows an error when the name is empty. */
  const commitIdentity = (): boolean => {
    const name = nameInput.value.trim();
    if (!name) {
      showError('Pick a name first.');
      nameInput.focus();
      return false;
    }
    saveIdentity({ name, color });
    return true;
  };

  const codeInput = h('input', {
    class: 'input input-code',
    placeholder: 'ABCD-EFGH',
    maxlength: 64,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Join code',
    oninput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el.value.includes('#')) return;
      const raw = el.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
      el.value = raw.length > 4 ? formatCode(raw) : raw;
    },
  });

  const create = () => {
    if (!commitIdentity()) return;
    const code = generateCode();
    markHosting(code);
    navigate({ name: 'room', code });
  };

  const join = (e: Event) => {
    e.preventDefault();
    if (!commitIdentity()) return;
    const code = codeFromInput(codeInput.value);
    if (!code) {
      showError('That code does not look right. It has 8 letters and digits, like ABCD-EFGH.');
      codeInput.focus();
      return;
    }
    navigate({ name: 'room', code });
  };

  root.append(
    h(
      'main',
      { class: 'home' },
      h(
        'section',
        { class: 'panel home-panel' },
        h(
          'header',
          { class: 'brand' },
          h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
          h('h1', null, 'Card Lobby'),
          h('p', { class: 'muted' }, 'Card games with friends, right in the browser.'),
        ),
        h('label', { class: 'field', for: 'name' }, h('span', { class: 'field-label' }, 'Your name'), nameInput),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), swatches),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: create }, 'Create lobby'),
        h('div', { class: 'divider' }, h('span', null, 'or join one')),
        h(
          'form',
          { class: 'join-row', onsubmit: join },
          codeInput,
          h('button', { type: 'submit', class: 'btn' }, 'Join'),
        ),
        error,
      ),
      h('p', { class: 'home-foot muted' }, 'Peer to peer and encrypted. No accounts, no servers.'),
    ),
  );
  nameInput.focus();
  nameInput.select();
};

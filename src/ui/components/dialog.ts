import { h } from '../dom';

/** A small modal yes/no question. Resolves true for the confirm button. */
export function confirmDialog(title: string, text: string, ok: string, cancel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const dialog = h(
      'dialog',
      { class: 'confirm-dialog', 'aria-label': title },
      h('h2', null, title),
      h('p', null, text),
      h(
        'div',
        { class: 'confirm-actions' },
        h('button', { type: 'button', class: 'btn', autofocus: true, onclick: () => dialog.close() }, cancel),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-danger',
            onclick: () => {
              answer = true;
              dialog.close();
            },
          },
          ok,
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

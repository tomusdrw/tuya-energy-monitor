import assert from 'node:assert/strict';
import { act, type ReactNode } from 'react';
import { Window } from 'happy-dom';

// Install the DOM before importing react-dom/client: React detects event support on import.
export const window = new Window({ url: 'http://localhost:3000' });
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  ResizeObserver: window.ResizeObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');

export async function mount(children: ReactNode) {
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  async function render(next: ReactNode) {
    await act(async () => root.render(next));
  }
  await render(children);
  return {
    container,
    render,
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
      await window.happyDOM.abort();
    },
  };
}

export function field(selector: string) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Missing field: ${selector}`);
  return element as unknown as HTMLInputElement;
}

export async function click(text: string) {
  const button = [...window.document.querySelectorAll('button')].find(
    (element) => element.textContent.trim() === text,
  );
  assert.ok(button, `Missing button: ${text}`);
  assert.equal(button.disabled, false, `Disabled button: ${text}`);
  await act(async () => button.click());
}

export async function change(selector: string, value: string) {
  const element = field(selector);
  await act(async () => {
    if (element.tagName === 'INPUT') {
      // Set the native value so React receives the same event as a user's edit.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
    } else {
      element.value = value;
      element.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event);
    }
  });
}

export async function check(selector: string) {
  await act(async () => field(selector).click());
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;

Element.prototype.scrollIntoView =
  Element.prototype.scrollIntoView ??
  function scrollIntoView() {};

// Node 22+/25 can leave jsdom localStorage incomplete under some runners.
const memoryStore = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear() {
    memoryStore.clear();
  },
  getItem(key) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  key(index) {
    return [...memoryStore.keys()][index] ?? null;
  },
  removeItem(key) {
    memoryStore.delete(key);
  },
  setItem(key, value) {
    memoryStore.set(key, String(value));
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageStub,
});
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageStub,
});

// jsdom has no 2D context. The landing hero's wave field already bails out when
// getContext returns null; stubbing it keeps that path quiet instead of logging
// an unimplemented-method error on every render.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
} as HTMLCanvasElement['getContext'];

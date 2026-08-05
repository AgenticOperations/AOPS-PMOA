import '@testing-library/jest-dom/vitest';

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;

Element.prototype.scrollIntoView =
  Element.prototype.scrollIntoView ??
  function scrollIntoView() {};

// jsdom has no 2D context. The landing hero's wave field already bails out when
// getContext returns null; stubbing it keeps that path quiet instead of logging
// an unimplemented-method error on every render.
HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
} as HTMLCanvasElement['getContext'];

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

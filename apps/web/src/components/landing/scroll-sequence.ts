'use client';

import { useEffect, useRef, useState } from 'react';

export interface ScrollStepInput {
  readonly top: number;
  readonly height: number;
  readonly viewport: number;
  readonly steps: number;
}

export function scrollStepForPosition({ top, height, viewport, steps }: ScrollStepInput): number {
  if (steps <= 1 || height <= viewport) return 0;

  const travel = height - viewport;
  const progress = Math.min(1, Math.max(0, -top / travel));
  return Math.min(steps - 1, Math.floor(progress * steps));
}

export function useScrollSequence(stepCount: number) {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || stepCount <= 1) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const section = sectionRef.current;
      if (section === null) return;
      const rect = section.getBoundingClientRect();
      const nextIndex = scrollStepForPosition({
        top: rect.top,
        height: rect.height,
        viewport: window.innerHeight,
        steps: stepCount,
      });
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    };
    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [stepCount]);

  return { activeIndex, sectionRef, setActiveIndex } as const;
}

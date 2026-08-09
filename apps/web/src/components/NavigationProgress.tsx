'use client';

/**
 * Top-of-screen navigation progress bar.
 *
 * Lives in the root layout — a singleton that persists across every route
 * change and is never destroyed by server-component page transitions.
 *
 * Strategy (App Router has no router event bus):
 *   • document-level capture click listener → start bar on same-origin
 *     in-app navigations (ignore modified clicks / new tabs).
 *   • history pushState/replaceState + popstate + usePathname → route
 *     committed; complete and hide (pathname alone can lag while the bar
 *     looks frozen at the soft cap).
 *   • safety timeout → hide if navigation never settles.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const SOFT_CAP = 98;
const SAFETY_MS = 8_000;
const FINISH_WIDTH_MS = 120;
const FINISH_HOLD_MS = 80;
const FADE_MS = 160;

export function NavigationProgress() {
  const pathname = usePathname();
  const trackRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPathname = useRef(pathname);
  const active = useRef(false);
  const finishing = useRef(false);
  const startedAtPath = useRef(pathname);

  function clearTimers() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (startTimer.current !== null) {
      clearTimeout(startTimer.current);
      startTimer.current = null;
    }
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (safetyTimer.current !== null) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  }

  function setWidth(w: number) {
    if (barRef.current) barRef.current.style.width = `${w}%`;
  }

  function getWidth(): number {
    return parseFloat(barRef.current?.style.width || '0') || 0;
  }

  function showTrack() {
    if (!trackRef.current || !barRef.current) return;
    trackRef.current.style.opacity = '1';
    barRef.current.style.opacity = '1';
    barRef.current.style.transition = 'none';
  }

  function hideTrack() {
    active.current = false;
    finishing.current = false;
    clearTimers();
    if (!trackRef.current || !barRef.current) return;
    trackRef.current.style.opacity = '0';
    barRef.current.style.width = '0%';
    barRef.current.style.opacity = '1';
    barRef.current.style.transition = 'none';
  }

  function runAnimation() {
    const step = () => {
      if (!active.current || finishing.current) return;
      const current = getWidth();
      if (current >= SOFT_CAP) return;

      // Fast early, then a continuous trickle so the bar never looks frozen
      // near the end while RSC navigation is still in flight.
      let delta: number;
      if (current < 40) delta = 2.4;
      else if (current < 70) delta = 1.1;
      else if (current < 90) delta = 0.35;
      else delta = 0.08;

      setWidth(Math.min(SOFT_CAP, current + delta));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function finishAnimation() {
    if (!active.current || finishing.current) return;
    finishing.current = true;
    clearTimers();

    if (barRef.current) {
      barRef.current.style.transition = `width ${FINISH_WIDTH_MS}ms ease-out, opacity ${FADE_MS}ms ease`;
      barRef.current.style.width = '100%';
      barRef.current.style.opacity = '1';
    }
    if (trackRef.current) trackRef.current.style.opacity = '1';

    hideTimer.current = setTimeout(() => {
      if (barRef.current) barRef.current.style.opacity = '0';
      if (trackRef.current) trackRef.current.style.opacity = '0';
      hideTimer.current = setTimeout(() => {
        hideTrack();
      }, FADE_MS + 20);
    }, FINISH_WIDTH_MS + FINISH_HOLD_MS);
  }

  function startAnimation() {
    if (finishing.current) {
      hideTrack();
    }
    clearTimers();
    active.current = true;
    finishing.current = false;
    startedAtPath.current = window.location.pathname;
    setWidth(0);
    showTrack();

    startTimer.current = setTimeout(() => {
      startTimer.current = null;
      if (!active.current || finishing.current) return;
      setWidth(12);
      runAnimation();
    }, 16);

    safetyTimer.current = setTimeout(() => {
      safetyTimer.current = null;
      finishAnimation();
    }, SAFETY_MS);
  }

  // Start bar on same-origin in-app link clicks.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (href.startsWith('http') || href.startsWith('//')) {
        try {
          const url = new URL(href, window.location.href);
          if (url.origin !== window.location.origin) return;
        } catch {
          return;
        }
      }

      let nextPath = href;
      try {
        nextPath = new URL(href, window.location.href).pathname;
      } catch {
        nextPath = href.split('?')[0]?.split('#')[0] ?? href;
      }

      if (nextPath === window.location.pathname) return;

      startAnimation();
    }

    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finish as soon as the URL commits (often earlier than usePathname).
  useEffect(() => {
    const { pushState, replaceState } = window.history;

    function onUrlCommit() {
      if (!active.current || finishing.current) return;
      if (window.location.pathname === startedAtPath.current) return;
      finishAnimation();
    }

    function wrap(method: typeof pushState) {
      return function patched(this: History, ...args: Parameters<typeof pushState>) {
        const result = method.apply(this, args);
        queueMicrotask(onUrlCommit);
        return result;
      };
    }

    window.history.pushState = wrap(pushState);
    window.history.replaceState = wrap(replaceState);
    window.addEventListener('popstate', onUrlCommit);

    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener('popstate', onUrlCommit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finish when the route settles (backup if history hooks miss).
  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;
    finishAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => () => clearTimers(), []);

  return (
    <div
      aria-hidden="true"
      className="nav-progress-track"
      ref={trackRef}
      style={{ opacity: 0 }}
    >
      <div className="nav-progress-bar" ref={barRef} style={{ width: '0%', opacity: 1 }} />
    </div>
  );
}

'use client';

/**
 * Top-of-screen navigation progress bar.
 *
 * Lives in the root layout — a singleton that persists across every route
 * change and is never destroyed by server-component page transitions.
 *
 * Strategy (App Router has no router event bus):
 *   • document-level capture click listener → start bar on any same-origin
 *     link click that isn't the current page.
 *   • usePathname() → route settled; complete and hide the bar.
 *
 * Width is driven by JS (requestAnimationFrame) so the finish transition
 * always starts from wherever the bar currently is, not a hardcoded %.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const prevPathname = useRef(pathname);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (hideTimer.current !== null) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }

  function getWidth(): number {
    return parseFloat(barRef.current?.style.width ?? '0');
  }

  function setWidth(w: number) {
    if (barRef.current) barRef.current.style.width = `${w}%`;
  }

  function setOpacity(o: number) {
    if (barRef.current) barRef.current.style.opacity = String(o);
  }

  // Easing: run from current width toward 85%, slowing as it approaches.
  function runAnimation() {
    const target = 85;
    const step = () => {
      const current = getWidth();
      if (current >= target) return;
      const delta = (target - current) * 0.04;
      setWidth(Math.min(target, current + Math.max(delta, 0.3)));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  // Snap to 100% then fade out.
  function finishAnimation() {
    clearTimers();
    setWidth(100);
    setOpacity(1);
    hideTimer.current = setTimeout(() => {
      setOpacity(0);
      hideTimer.current = setTimeout(() => {
        setVisible(false);
        setWidth(0);
        setOpacity(1);
      }, 300);
    }, 160);
  }

  // Start bar on any same-origin link click that targets a different path.
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) return;

      // Extract pathname from href (may be relative like /app/slug/agents).
      const normalized = href.split('?')[0];
      if (normalized === window.location.pathname) return;

      clearTimers();
      setWidth(0);
      setOpacity(1);
      setVisible(true);
      // Tiny delay lets the DOM mount before animating.
      setTimeout(runAnimation, 16);
    }

    document.addEventListener('click', handleClick, { capture: true });
    return () => document.removeEventListener('click', handleClick, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finish when the route settles.
  useEffect(() => {
    if (pathname === prevPathname.current) return;
    prevPathname.current = pathname;
    finishAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => () => clearTimers(), []);

  if (!visible) return null;

  return (
    <div aria-hidden="true" className="nav-progress-track">
      <div className="nav-progress-bar" ref={barRef} />
    </div>
  );
}

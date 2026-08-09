'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { IconRoute, IconRobot, IconShoppingBag, IconX } from '@tabler/icons-react';
import { stepsForPath, tourRoute } from '@/lib/platform-tour/steps';
import { readTourState, shouldAutoOfferTour, writeTourState } from '@/lib/platform-tour/storage';
import {
  PLATFORM_TOUR_VERSION,
  type PlatformTourState,
  type TourPath,
} from '@/lib/platform-tour/types';

type PlatformTourProps = {
  readonly orgSlug: string;
};

const AUTO_OFFER_DELAY_MS = 700;
const ELEMENT_WAIT_MS = 1600;

function setTourRunningClass(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('aops-tour-running', active);
}

async function waitForElement(selector: string | undefined, timeoutMs: number): Promise<Element | null> {
  if (selector === undefined) return null;
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  return document.querySelector(selector);
}

export function PlatformTour({ orgSlug }: PlatformTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const driverRef = useRef<Driver | null>(null);
  const navigatingRef = useRef(false);
  const pathRef = useRef<TourPath | null>(null);
  const bootLockRef = useRef(false);
  const [state, setState] = useState<PlatformTourState | null>(null);
  const [booting, setBooting] = useState(true);
  /** Mute only while hopping routes — never under an active spotlight. */
  const [bridging, setBridging] = useState(false);

  const persist = useCallback((next: PlatformTourState) => {
    writeTourState(orgSlug, next);
    setState(next);
    pathRef.current = next.path;
    setTourRunningClass(next.phase === 'welcome' || next.phase === 'running');
  }, [orgSlug]);

  useEffect(() => {
    const existing = readTourState(orgSlug);
    pathRef.current = existing.path;
    setTourRunningClass(existing.phase === 'welcome' || existing.phase === 'running');
    if (shouldAutoOfferTour(existing)) {
      const timer = window.setTimeout(() => {
        persist({
          phase: 'welcome',
          path: null,
          stepIndex: 0,
          version: PLATFORM_TOUR_VERSION,
        });
        setBooting(false);
      }, AUTO_OFFER_DELAY_MS);
      setState(existing);
      return () => window.clearTimeout(timer);
    }
    setState(existing);
    setBooting(false);
    return undefined;
  }, [orgSlug, persist]);

  const destroyDriver = useCallback(() => {
    driverRef.current?.destroy();
    driverRef.current = null;
  }, []);

  const dismiss = useCallback((phase: 'dismissed' | 'completed') => {
    navigatingRef.current = true;
    bootLockRef.current = false;
    setBridging(false);
    destroyDriver();
    navigatingRef.current = false;
    persist({
      phase,
      path: pathRef.current,
      stepIndex: 0,
      version: PLATFORM_TOUR_VERSION,
    });
    setTourRunningClass(false);
  }, [destroyDriver, persist]);

  const runFromIndex = useCallback(async (path: TourPath, startIndex: number) => {
    if (bootLockRef.current) return;
    bootLockRef.current = true;

    const steps = stepsForPath(path);
    if (steps.length === 0) {
      bootLockRef.current = false;
      dismiss('completed');
      return;
    }

    const clamped = Math.min(Math.max(startIndex, 0), steps.length - 1);
    const active = steps[clamped];
    if (active === undefined) {
      bootLockRef.current = false;
      dismiss('completed');
      return;
    }

    const targetRoute = tourRoute(orgSlug, active.route);
    const onTarget =
      targetRoute === null
      || pathname === targetRoute
      || Boolean(pathname?.startsWith(`${targetRoute}/`));

    if (!onTarget && targetRoute !== null) {
      setBridging(true);
      navigatingRef.current = true;
      destroyDriver();
      navigatingRef.current = false;
      persist({
        phase: 'running',
        path,
        stepIndex: clamped,
        version: PLATFORM_TOUR_VERSION,
      });
      bootLockRef.current = false;
      router.push(targetRoute);
      return;
    }

    await waitForElement(active.element, ELEMENT_WAIT_MS);

    // Route changed while waiting — let the pathname effect resume.
    if (
      targetRoute !== null
      && pathname !== targetRoute
      && !pathname?.startsWith(`${targetRoute}/`)
    ) {
      bootLockRef.current = false;
      return;
    }

    navigatingRef.current = true;
    destroyDriver();
    navigatingRef.current = false;

    const goToStepRoute = (index: number) => {
      const step = steps[index];
      if (step === undefined) return false;
      const route = tourRoute(orgSlug, step.route);
      if (route === null) return false;
      if (pathname === route || pathname?.startsWith(`${route}/`)) return false;
      setBridging(true);
      navigatingRef.current = true;
      persist({
        phase: 'running',
        path,
        stepIndex: index,
        version: PLATFORM_TOUR_VERSION,
      });
      driverRef.current?.destroy();
      driverRef.current = null;
      navigatingRef.current = false;
      bootLockRef.current = false;
      router.push(route);
      return true;
    };

    const instance = driver({
      // Stage morph animation causes spotlight jitter.
      animate: false,
      smoothScroll: false,
      allowClose: true,
      disableActiveInteraction: false,
      overlayClickBehavior: undefined as unknown as 'close',
      overlayOpacity: 0.58,
      stagePadding: 8,
      stageRadius: 10,
      popoverOffset: 12,
      popoverClass: 'aops-tour-popover',
      overlayColor: 'rgb(8, 10, 14)',
      showProgress: true,
      progressText: '{{current}} · {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Finish',
      onHighlightStarted: (element) => {
        setBridging(false);
        document.querySelectorAll('.aops-tour-spotlight').forEach((node) => {
          node.classList.remove('aops-tour-spotlight');
        });
        if (element instanceof HTMLElement) {
          element.classList.add('aops-tour-spotlight');
        }
      },
      onDestroyed: () => {
        document.querySelectorAll('.aops-tour-spotlight').forEach((node) => {
          node.classList.remove('aops-tour-spotlight');
        });
      },
      onDestroyStarted: (_element, _step, opts) => {
        if (navigatingRef.current) {
          opts.driver.destroy();
          return;
        }
        const idx = opts.driver.getActiveIndex() ?? clamped;
        const atEnd = idx >= steps.length - 1;
        setBridging(false);
        bootLockRef.current = false;
        persist({
          phase: atEnd ? 'completed' : 'dismissed',
          path,
          stepIndex: 0,
          version: PLATFORM_TOUR_VERSION,
        });
        setTourRunningClass(false);
        opts.driver.destroy();
        driverRef.current = null;
      },
      onPopoverRender: (popover) => {
        const footer = popover.footer;
        if (footer.querySelector('.aops-tour-skip') !== null) return;
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'aops-tour-skip';
        skip.textContent = 'Skip tour';
        skip.addEventListener('click', () => dismiss('dismissed'));
        footer.insertBefore(skip, footer.firstChild);
      },
      steps: steps.map((step) => ({
        ...(step.element !== undefined ? { element: step.element } : {}),
        popover: {
          title: step.title,
          description: step.description,
          side: step.side ?? 'bottom',
          align: 'start' as const,
          onNextClick: (_element: Element | undefined, _step: unknown, opts: { driver: Driver }) => {
            const nextIndex = (opts.driver.getActiveIndex() ?? 0) + 1;
            if (nextIndex >= steps.length) {
              navigatingRef.current = true;
              setBridging(false);
              bootLockRef.current = false;
              persist({
                phase: 'completed',
                path,
                stepIndex: 0,
                version: PLATFORM_TOUR_VERSION,
              });
              setTourRunningClass(false);
              opts.driver.destroy();
              driverRef.current = null;
              navigatingRef.current = false;
              return;
            }
            if (goToStepRoute(nextIndex)) return;
            persist({
              phase: 'running',
              path,
              stepIndex: nextIndex,
              version: PLATFORM_TOUR_VERSION,
            });
            opts.driver.moveNext();
          },
          onPrevClick: (_element: Element | undefined, _step: unknown, opts: { driver: Driver }) => {
            const prevIndex = (opts.driver.getActiveIndex() ?? 0) - 1;
            if (prevIndex < 0) return;
            if (goToStepRoute(prevIndex)) return;
            persist({
              phase: 'running',
              path,
              stepIndex: prevIndex,
              version: PLATFORM_TOUR_VERSION,
            });
            opts.driver.movePrevious();
          },
        },
      })),
    });

    driverRef.current = instance;
    persist({
      phase: 'running',
      path,
      stepIndex: clamped,
      version: PLATFORM_TOUR_VERSION,
    });

    instance.drive(clamped);
    setBridging(false);
    // Keep bootLock until destroy/navigation so the resume effect cannot double-start.
  }, [destroyDriver, dismiss, orgSlug, pathname, persist, router]);

  useEffect(() => {
    if (booting || state === null) return;
    if (state.phase !== 'running' || state.path === null) return;
    if (driverRef.current?.isActive() || bootLockRef.current) {
      if (driverRef.current?.isActive()) setBridging(false);
      return;
    }

    const steps = stepsForPath(state.path);
    const active = steps[state.stepIndex];
    if (active === undefined) {
      dismiss('completed');
      return;
    }

    const targetRoute = tourRoute(orgSlug, active.route);
    if (
      targetRoute !== null
      && pathname !== targetRoute
      && !pathname?.startsWith(`${targetRoute}/`)
    ) {
      setBridging(true);
      return;
    }

    setBridging(true);
    void runFromIndex(state.path, state.stepIndex);
  }, [booting, dismiss, orgSlug, pathname, runFromIndex, state]);

  useEffect(() => () => {
    navigatingRef.current = true;
    destroyDriver();
    setTourRunningClass(false);
  }, [destroyDriver]);

  useEffect(() => {
    function onReplay() {
      navigatingRef.current = true;
      bootLockRef.current = false;
      setBridging(false);
      destroyDriver();
      navigatingRef.current = false;
      persist({
        phase: 'welcome',
        path: null,
        stepIndex: 0,
        version: PLATFORM_TOUR_VERSION,
      });
    }
    window.addEventListener('agentops:platform-tour-replay', onReplay);
    return () => window.removeEventListener('agentops:platform-tour-replay', onReplay);
  }, [destroyDriver, persist]);

  const tourActive = state?.phase === 'welcome' || state?.phase === 'running';

  if (state === null || !tourActive) {
    return null;
  }

  return (
    <>
      {bridging ? <div aria-hidden="true" className="aops-tour-veil" /> : null}

      {state.phase === 'welcome' ? (
        <div aria-modal="true" className="aops-tour-welcome" role="dialog">
          <div aria-hidden="true" className="aops-tour-welcome-backdrop" />
          <div className="aops-tour-welcome-card">
            <button
              aria-label="Close tour"
              className="aops-tour-welcome-close"
              onClick={() => dismiss('dismissed')}
              type="button"
            >
              <IconX aria-hidden="true" size={18} stroke={2} />
            </button>
            <p className="aops-tour-welcome-eyebrow">Optional walkthrough</p>
            <h2>How agentOps works</h2>
            <p className="aops-tour-welcome-copy">
              A short story from creating an agent to publishing and hiring.
              Close anytime with the × — nothing is required.
            </p>
            <div className="aops-tour-path-grid">
              <button
                className="aops-tour-path-card"
                onClick={() => {
                  void runFromIndex('publish', 0);
                }}
                type="button"
              >
                <IconShoppingBag aria-hidden="true" size={18} stroke={1.8} />
                <strong>Publish & hire</strong>
                <span>Create → policy → fund → publish → marketplace</span>
              </button>
              <button
                className="aops-tour-path-card"
                onClick={() => {
                  void runFromIndex('mcp', 0);
                }}
                type="button"
              >
                <IconRobot aria-hidden="true" size={18} stroke={1.8} />
                <strong>Connect via MCP</strong>
                <span>Create → policy → credential → approvals</span>
              </button>
              <button
                className="aops-tour-path-card"
                onClick={() => {
                  void runFromIndex('explore', 0);
                }}
                type="button"
              >
                <IconRoute aria-hidden="true" size={18} stroke={1.8} />
                <strong>Just show me around</strong>
                <span>Light tour of the full console map</span>
              </button>
            </div>
            <div className="aops-tour-welcome-actions">
              <button className="aops-tour-text-btn" onClick={() => dismiss('dismissed')} type="button">
                Skip for now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function requestPlatformTourReplay(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('agentops:platform-tour-replay'));
}

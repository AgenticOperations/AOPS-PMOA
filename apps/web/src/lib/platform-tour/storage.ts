import {
  PLATFORM_TOUR_STORAGE_PREFIX,
  PLATFORM_TOUR_VERSION,
  type PlatformTourState,
  type TourPath,
  type TourPhase,
} from './types';

const DEFAULT_STATE: PlatformTourState = {
  phase: 'idle',
  path: null,
  stepIndex: 0,
  version: PLATFORM_TOUR_VERSION,
};

function storageKey(orgSlug: string): string {
  return `${PLATFORM_TOUR_STORAGE_PREFIX}${orgSlug}`;
}

function isTourPath(value: unknown): value is TourPath {
  return value === 'publish' || value === 'mcp' || value === 'explore';
}

function isTourPhase(value: unknown): value is TourPhase {
  return (
    value === 'idle'
    || value === 'welcome'
    || value === 'running'
    || value === 'dismissed'
    || value === 'completed'
  );
}

export function readTourState(orgSlug: string): PlatformTourState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey(orgSlug));
    if (raw === null) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PlatformTourState>;
    if (parsed.version !== PLATFORM_TOUR_VERSION) return DEFAULT_STATE;
    return {
      phase: isTourPhase(parsed.phase) ? parsed.phase : 'idle',
      path: isTourPath(parsed.path) ? parsed.path : null,
      stepIndex: typeof parsed.stepIndex === 'number' && parsed.stepIndex >= 0 ? parsed.stepIndex : 0,
      version: PLATFORM_TOUR_VERSION,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function writeTourState(orgSlug: string, state: PlatformTourState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(orgSlug), JSON.stringify(state));
  } catch {
    // Ignore quota / private mode failures — tour remains optional.
  }
}

export function shouldAutoOfferTour(state: PlatformTourState): boolean {
  return state.phase === 'idle';
}

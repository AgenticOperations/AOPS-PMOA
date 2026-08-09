export type TourPath = 'publish' | 'mcp' | 'explore';

export type TourPhase = 'idle' | 'welcome' | 'running' | 'dismissed' | 'completed';

export type TourStepId =
  | 'map'
  | 'agents'
  | 'add-agent'
  | 'controls'
  | 'fund'
  | 'empower'
  | 'marketplace'
  | 'approvals'
  | 'done';

export type PlatformTourStep = {
  readonly id: TourStepId;
  readonly title: string;
  readonly description: string;
  /** CSS selector; when missing, show centered card only. */
  readonly element?: string;
  /** Relative route under `/app/{orgSlug}` (no leading slash). Empty = stay. */
  readonly route?: string;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly paths?: readonly TourPath[];
};

export type PlatformTourState = {
  readonly phase: TourPhase;
  readonly path: TourPath | null;
  readonly stepIndex: number;
  readonly version: number;
};

export const PLATFORM_TOUR_VERSION = 2;
export const PLATFORM_TOUR_STORAGE_PREFIX = 'agentops-platform-tour:v1:';

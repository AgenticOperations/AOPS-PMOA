'use client';

import { IconCompass } from '@tabler/icons-react';
import { requestPlatformTourReplay } from './PlatformTour';

export function TourReplayButton() {
  return (
    <button
      className="aops-tour-replay"
      onClick={() => requestPlatformTourReplay()}
      title="Platform walkthrough"
      type="button"
    >
      <IconCompass aria-hidden="true" size={16} stroke={1.8} />
      <span>Tour</span>
    </button>
  );
}

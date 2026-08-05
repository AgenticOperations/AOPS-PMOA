'use client';

import Link from 'next/link';
import { Waves } from './Waves';

/**
 * Ported from the Casper marketing hero: full-bleed wave field, primary-blue
 * glow rising from the baseline, bottom-aligned copy at a restrained type size.
 */
export function Hero() {
  return (
    <section className="aops-hero" id="top">
      <div className="aops-hero-field">
        <Waves
          friction={0.92}
          lineColor="rgba(255,255,255,0.18)"
          maxCursorMove={120}
          tension={0.008}
          waveAmpX={38}
          waveAmpY={18}
          waveSpeedX={0.0125}
          waveSpeedY={0.008}
          xGap={11}
          yGap={34}
        />
      </div>
      {/* Primary glow sits between the wave field and the copy. */}
      <div aria-hidden="true" className="aops-hero-glow" />
      {/* Baseline darkening so the copy keeps contrast over the glow. */}
      <div aria-hidden="true" className="aops-hero-shade" />

      <div className="aops-hero-content">
        <span className="aops-hero-chip">CONTROL PLANE</span>
        <h1 aria-label="Let agents act. Keep authority.">
          Let agents act.<br />
          <span>Keep authority.</span>
        </h1>
        <p>
          Identity, policy, approvals, treasury, and evidence for every agent action. Boundaries are
          evaluated before an action reaches a tool or a payment rail — and the outcome stays
          verifiable afterwards.
        </p>
        <div className="aops-hero-actions">
          <Link aria-label="Request access" className="aops-cta" href="/auth">
            <span>REQUEST ACCESS</span>
            <i aria-hidden="true">→</i>
          </Link>
          <Link aria-label="Sign in" className="aops-cta aops-cta-ghost" href="/auth">
            <span>SIGN IN</span>
            <i aria-hidden="true">→</i>
          </Link>
        </div>
      </div>
    </section>
  );
}

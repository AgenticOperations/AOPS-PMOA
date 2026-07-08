import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

type AuthEntryShellProps = {
  readonly activeStep: 1 | 2 | 3;
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
};

const entryVideoUrl = '/AuthVideo.mp4';

export function AuthEntryShell({ children, description, eyebrow, title }: AuthEntryShellProps) {
  return (
    <main className="entry-shell">
      <ThemeToggle className="theme-toggle-floating" />
      <section aria-label="agentOps activation path" className="entry-video-pane">
        <video autoPlay className="entry-video" loop muted playsInline preload="metadata">
          <source src={entryVideoUrl} type="video/mp4" />
        </video>

        <div className="entry-video-message">
          <p>Let your agents operate with a strict functional control harness.</p>
        </div>
      </section>

      <section aria-labelledby="entry-panel-title" className="entry-panel">
        <div className="entry-panel-inner">
          {eyebrow !== undefined ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id="entry-panel-title">{title}</h2>
          <p className="entry-panel-copy">{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}

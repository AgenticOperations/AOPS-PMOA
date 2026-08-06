import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrustedBadge } from '../../src/components/payments/TrustedBadge.js';

describe('TrustedBadge', () => {
  it('renders a trusted state with an accessible label', () => {
    render(<TrustedBadge trusted />);
    // Screen readers must get the meaning, not just a tick glyph.
    expect(screen.getByLabelText(/trusted/i)).toBeTruthy();
  });

  it('renders an untrusted state distinctly', () => {
    render(<TrustedBadge trusted={false} />);
    expect(screen.getByLabelText(/not trusted/i)).toBeTruthy();
  });

  it('never implies arbitration or dispute', () => {
    const { container } = render(<TrustedBadge trusted />);
    expect(container.textContent).not.toMatch(/arbitrat|dispute|appeal/i);
  });
});

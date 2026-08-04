import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '../../src/app/page.js';

describe('AOPS public landing page', () => {
  it('renders the approved public narrative with auth as the product entry', async () => {
    render(await HomePage());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Let agents act. Keep authority.' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Request access' })[0]).toHaveAttribute(
      'href',
      '/auth',
    );
    expect(screen.getAllByRole('link', { name: 'Sign in' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining('/auth') })]),
    );
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to dark theme/i })).not.toBeInTheDocument();
  });

  it('exposes four control stages and presents supported chains as compatibility proof', async () => {
    render(await HomePage());

    const stages = screen.getByRole('tablist', { name: 'Control plane stages' });
    expect(within(stages).getAllByRole('tab')).toHaveLength(4);
    expect(within(stages).getByRole('tab', { name: /Identify/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    expect(screen.queryByRole('tablist', { name: 'Supported USDC chains' })).not.toBeInTheDocument();

    const chains = screen.getByRole('list', { name: 'Supported networks' });
    // 5 Gateway chains + Arc, the product's home chain.
    expect(within(chains).getAllByRole('listitem')).toHaveLength(6);
    expect(within(chains).getByText('Base')).toBeInTheDocument();
    expect(within(chains).getByText('Avalanche')).toBeInTheDocument();
    expect(screen.getByText('One treasury surface. Every execution path.')).toBeInTheDocument();
    expect(screen.getByText('Organization-owned authority')).toBeInTheDocument();
    expect(screen.getByText('Route-aware liquidity')).toBeInTheDocument();
    expect(screen.getByText('One evidence trail')).toBeInTheDocument();
    expect(screen.queryByText('2 rails verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('uses local canonical chain assets and a complete reveal footer', async () => {
    const { container } = render(await HomePage());

    const expectedSources = [
      '/landing/chains/base.png',
      '/landing/chains/arbitrum.svg',
      '/landing/chains/polygon.svg',
      '/landing/chains/optimism.svg',
      '/landing/chains/avalanche.svg',
      // Arc is the product's home chain -- it belongs in the compatibility
      // proof alongside the Gateway chains.
      '/landing/chains/arc.svg',
    ];
    const chainSources = Array.from(
      container.querySelectorAll<HTMLImageElement>('[data-chain-logo]'),
      (image) => image.getAttribute('src'),
    );
    expect(new Set(chainSources)).toEqual(new Set(expectedSources));

    const footer = screen.getByRole('contentinfo', { name: 'AOPS footer' });
    expect(within(footer).getByRole('img', { name: 'AOPS' })).toHaveAttribute(
      'src',
      '/landing/aops-wordmark.png',
    );
    expect(within(footer).getByText('Testnet treasury')).toBeInTheDocument();
  });

  it('provides production hooks for navigation, the hero signal, and treasury compatibility proof', async () => {
    const { container } = render(await HomePage());
    const navigation = container.querySelector('.aops-nav');

    expect(navigation?.querySelector('.aops-brand img')).toHaveAttribute(
      'src',
      '/landing/aops-wordmark-nav.png',
    );

    expect(navigation).toHaveAttribute('data-scrolled', 'false');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 });
    fireEvent.scroll(window);
    expect(navigation).toHaveAttribute('data-scrolled', 'true');

    expect(container.querySelectorAll('[data-signal-runner]')).toHaveLength(2);
    expect(container.querySelector('[data-treasury-boundary]')).toBeInTheDocument();
    expect(container.querySelector('[data-chain-marquee]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-chain-marquee-track] > ul')).toHaveLength(2);
  });
});

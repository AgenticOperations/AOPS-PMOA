'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

type CommandPaletteProps = {
  readonly orgSlug: string;
};

export function CommandPalette({ orgSlug }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const base = `/app/${orgSlug}`;
  const pages = useMemo(
    () => [
      { group: 'Workspace', href: `${base}/overview`, label: 'Overview' },
      { group: 'Identity', href: `${base}/agents`, label: 'Agents' },
      { group: 'Identity', href: `${base}/controls`, label: 'Controls' },
      { group: 'Runtime', href: `${base}/operations`, label: 'Operations' },
      { group: 'Runtime', href: `${base}/approvals`, label: 'Approvals' },
      { group: 'Treasury', href: `${base}/payments`, label: 'Treasury Overview' },
      { group: 'Treasury', href: `${base}/payments/sources`, label: 'Sources & Rails' },
      { group: 'Treasury', href: `${base}/payments/agent-access`, label: 'Agent Access' },
      { group: 'Treasury', href: `${base}/payments/liquidity`, label: 'Liquidity' },
      { group: 'Treasury', href: `${base}/payments/activity`, label: 'Activity & Evidence' },
      { group: 'Org', href: `${base}/settings`, label: 'Settings' },
    ],
    [base],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => {
          if (!current) {
            returnFocusRef.current = document.activeElement instanceof HTMLElement
              ? document.activeElement
              : launcherRef.current;
          }
          return !current;
        });
      }

    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const launcher = launcherRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== 'Tab' || dialogRef.current === null) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusRef.current ?? launcher)?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  const openPalette = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : launcherRef.current;
    setOpen(true);
  };

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="command-launcher"
        onClick={openPalette}
        ref={launcherRef}
        title="Open command menu"
        type="button"
      >
        <IconSearch aria-hidden="true" size={16} stroke={1.8} />
        <span>Jump</span>
        <kbd>⌘K</kbd>
      </button>
      {open ? (
        <div className="command-overlay">
          <button
            aria-label="Close command menu"
            className="command-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div
            aria-labelledby="command-palette-title"
            aria-modal="true"
            className="command-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 className="sr-only" id="command-palette-title">
              Page jump
            </h2>
            <Command shouldFilter>
              <CommandInput autoFocus placeholder="Jump to a console page..." />
              <CommandList>
                <CommandEmpty>No page found.</CommandEmpty>
                {['Workspace', 'Identity', 'Runtime', 'Treasury', 'Org'].map((group) => (
                  <CommandGroup heading={group} key={group}>
                    {pages
                      .filter((page) => page.group === group)
                      .map((page) => (
                        <CommandItem
                          key={page.href}
                          onSelect={() => navigate(page.href)}
                          value={`${page.group} ${page.label}`}
                        >
                          <span>{page.label}</span>
                          <IconArrowRight aria-hidden="true" className="command-item-arrow" size={15} />
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}

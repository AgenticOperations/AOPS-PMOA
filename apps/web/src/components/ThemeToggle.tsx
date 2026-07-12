'use client';

import { IconMoon, IconSun } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

type ThemeToggleProps = {
  readonly className?: string;
};

const storageKey = 'agentops-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function resolveTheme(): Theme {
  if (typeof window === 'undefined') return 'light';

  const storedTheme = window.localStorage.getItem(storageKey);
  if (isTheme(storedTheme)) return storedTheme;

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return prefersDark ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const initialTheme = resolveTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
  }

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const classes = className === undefined ? 'theme-toggle' : `theme-toggle ${className}`;

  return (
    <button
      aria-label={`${theme === 'dark' ? 'Dark' : 'Light'} theme. Switch to ${nextTheme} theme`}
      className={classes}
      onClick={toggleTheme}
      title={`Switch to ${nextTheme} theme`}
      type="button"
    >
      {theme === 'dark' ? (
        <IconMoon aria-hidden="true" size={16} stroke={1.8} />
      ) : (
        <IconSun aria-hidden="true" size={16} stroke={1.8} />
      )}
    </button>
  );
}

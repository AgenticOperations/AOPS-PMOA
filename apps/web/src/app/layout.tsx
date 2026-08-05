import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import { NavigationProgress } from '@/components/NavigationProgress';
import './globals.css';
import './agents.css';
import './overview.css';
import './controls.css';
import './operations.css';
import './approvals.css';
import './payments.css';
import './settings.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'agentOps PMOA',
  description: 'Clean PMOA control plane build for agent operations.',
  icons: {
    icon: [{ sizes: '160x160', type: 'image/png', url: '/landing/aops-tab-icon.png' }],
  },
};

const themeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem('agentops-theme');
    const prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={montserrat.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <NavigationProgress />
        {children}
      </body>
    </html>
  );
}

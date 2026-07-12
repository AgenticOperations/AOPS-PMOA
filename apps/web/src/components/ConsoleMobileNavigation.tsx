'use client';

import { useState } from 'react';
import { IconMenu2 } from '@tabler/icons-react';
import type { Org } from '@/lib/identity-spine-types';
import { ConsoleSidebarNav } from './ConsoleSidebarNav';
import { Sheet, SheetBody, SheetTitle } from './ui/sheet';

export function ConsoleMobileNavigation({ org }: { readonly org: Org }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button aria-label="Open navigation" className="mobile-nav-trigger" onClick={() => setOpen(true)} type="button">
        <IconMenu2 aria-hidden="true" size={19} stroke={1.8} />
      </button>
      <Sheet labelledBy="mobile-navigation-title" onOpenChange={setOpen} open={open} side="left">
        <SheetTitle className="sr-only" id="mobile-navigation-title">Workspace navigation</SheetTitle>
        <SheetBody className="mobile-navigation-body">
          <ConsoleSidebarNav className="mobile-sidebar" collapsible={false} onNavigate={() => setOpen(false)} org={org} />
        </SheetBody>
      </Sheet>
    </>
  );
}

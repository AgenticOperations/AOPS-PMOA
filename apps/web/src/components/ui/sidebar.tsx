'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function Sidebar({ className, ...props }: React.ComponentProps<'aside'>) {
  return (
    <aside
      className={cn(
        'flex h-full flex-col overflow-hidden bg-[var(--bg-soft)] text-[var(--text-primary)] ring-1 ring-[var(--border-subtle)]',
        className,
      )}
      data-slot="sidebar"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('border-b border-[var(--border-subtle)] p-3', className)} data-slot="sidebar-header" {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-auto p-3', className)} data-slot="sidebar-content" {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('border-t border-[var(--border-subtle)] p-3', className)} data-slot="sidebar-footer" {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'section'>) {
  return <section className={cn('grid gap-2 py-2', className)} data-slot="sidebar-group" {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'px-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]',
        className,
      )}
      data-slot="sidebar-group-label"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul className={cn('grid list-none gap-1 p-0 m-0', className)} data-slot="sidebar-menu" {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li className={cn('min-w-0', className)} data-slot="sidebar-menu-item" {...props} />;
}

function SidebarMenuButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<'button'> & { readonly isActive?: boolean }) {
  return (
    <button
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]',
        isActive && 'bg-[var(--accent-tint)] text-[var(--accent-blue)]',
        className,
      )}
      data-active={isActive ? 'true' : undefined}
      data-slot="sidebar-menu-button"
      type="button"
      {...props}
    />
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul className={cn('grid list-none gap-1 p-0 pl-6 m-0', className)} data-slot="sidebar-menu-sub" {...props} />;
}

function SidebarMenuSubButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<'button'> & { readonly isActive?: boolean }) {
  return (
    <button
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]',
        isActive && 'bg-[var(--accent-tint)] text-[var(--accent-blue)]',
        className,
      )}
      data-active={isActive ? 'true' : undefined}
      data-slot="sidebar-menu-sub-button"
      type="button"
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
};

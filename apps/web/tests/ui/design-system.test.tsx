import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '../../src/components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../src/components/ui/card.js';
import { EmptyState } from '../../src/components/ui/empty-state.js';
import { Sheet, SheetBody, SheetCloseButton, SheetHeader, SheetTitle } from '../../src/components/ui/sheet.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../src/components/ui/table.js';
import { TableShell } from '../../src/components/ui/table-shell.js';

describe('Phase 0 design primitives', () => {
  it('renders static cards with ring elevation and no static shadow classes', () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Policy library</CardTitle>
          <CardDescription>Reusable rules.</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
      </Card>,
    );

    const card = container.querySelector('[data-slot="card"]');
    expect(card).toBeInTheDocument();
    expect(card?.className).toContain('ring-1');
    expect(card?.className).not.toMatch(/\bshadow-/);
  });

  it('renders pill status color without heavy semantic fills', () => {
    render(<Badge variant="danger">Denied</Badge>);
    const badge = screen.getByText('Denied');

    expect(badge).toHaveClass('rounded-full');
    expect(badge.className).toContain('state-danger-tint');
  });

  it('renders table shell with bounded scroll surface', () => {
    render(
      <TableShell maxHeight={320}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>runtime.http.request</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableShell>,
    );

    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByText('runtime.http.request')).toBeInTheDocument();
  });

  it('renders useful empty states without placeholder metrics', () => {
    render(
      <EmptyState
        description="Create an agent before issuing credentials."
        title="No agents registered"
        variant="agents"
      />,
    );

    expect(screen.getByText('No agents registered')).toBeInTheDocument();
    expect(screen.getByText('Create an agent before issuing credentials.')).toBeInTheDocument();
    expect(screen.queryByText(/0\/1/i)).not.toBeInTheDocument();
  });

  it('exposes sheet dialog semantics and keyboard close behavior', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <Sheet labelledBy="sheet-title" onOpenChange={onOpenChange} open>
        <SheetHeader>
          <SheetTitle id="sheet-title">Policy details</SheetTitle>
          <SheetCloseButton onClick={() => onOpenChange(false)} />
        </SheetHeader>
        <SheetBody>Decision context</SheetBody>
      </Sheet>,
    );

    expect(screen.getByRole('dialog', { name: /Policy details/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves focus into an open sheet, traps tab focus, and restores its trigger', async () => {
    const user = userEvent.setup();

    function SheetHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open details</button>
          <Sheet labelledBy="focus-sheet-title" onOpenChange={setOpen} open={open}>
            <SheetHeader>
              <SheetTitle id="focus-sheet-title">Focus details</SheetTitle>
              <SheetCloseButton onClick={() => setOpen(false)} />
            </SheetHeader>
            <SheetBody>
              <button type="button">First action</button>
              <button type="button">Last action</button>
            </SheetBody>
          </Sheet>
        </>
      );
    }

    render(<SheetHarness />);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    await user.click(trigger);

    const close = screen.getByRole('button', { name: 'Close panel' });
    expect(close).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('does not reset drawer focus when an inline open-change callback rerenders', async () => {
    const user = userEvent.setup();

    function UnstableCallbackHarness() {
      const [open, setOpen] = useState(false);
      const [revision, setRevision] = useState(0);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open editor</button>
          <Sheet labelledBy="unstable-sheet-title" onOpenChange={(nextOpen) => setOpen(nextOpen)} open={open}>
            <SheetHeader><SheetTitle id="unstable-sheet-title">Editor</SheetTitle></SheetHeader>
            <SheetBody>
              <button onClick={() => setRevision((value) => value + 1)} type="button">Update {revision}</button>
            </SheetBody>
          </Sheet>
        </>
      );
    }

    render(<UnstableCallbackHarness />);
    await user.click(screen.getByRole('button', { name: 'Open editor' }));
    const update = screen.getByRole('button', { name: 'Update 0' });
    await user.click(update);

    expect(screen.getByRole('button', { name: 'Update 1' })).toHaveFocus();
  });
});

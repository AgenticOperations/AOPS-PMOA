import { render, screen } from '@testing-library/react';
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
});

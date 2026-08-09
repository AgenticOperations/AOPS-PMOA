import { formatUtcDateTime } from '@/lib/date-format';
import type { AgentJoinInviteRecord } from '@/lib/server/identity-spine-client';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';

type JoinInviteTableProps = {
  readonly invites: readonly AgentJoinInviteRecord[];
  readonly revokeAction: (formData: FormData) => Promise<void>;
};

function inviteStatus(invite: AgentJoinInviteRecord): {
  readonly label: string;
  readonly status: string;
} {
  if (invite.revoked_at !== null) return { label: 'Revoked', status: 'revoked' };
  if (invite.expires_at !== null && new Date(invite.expires_at).getTime() <= Date.now()) {
    return { label: 'Expired', status: 'inactive' };
  }
  if (invite.use_count >= invite.max_uses) return { label: 'Exhausted', status: 'inactive' };
  return { label: 'Active', status: 'active' };
}

export function JoinInviteTable({ invites, revokeAction }: JoinInviteTableProps) {
  if (invites.length === 0) {
    return (
      <section className="registry-empty-state">
        <span aria-hidden="true" className="registry-empty-mark">
          JI
        </span>
        <h2>No join invites yet</h2>
        <p>Create an invite, copy the token once, and give it to an agent for sandbox join.</p>
      </section>
    );
  }

  return (
    <TableShell className="registry-table-shell" maxHeight={640}>
      <Table aria-label="Agent join invites" className="registry-table">
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Uses</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map((invite) => {
            const status = inviteStatus(invite);
            const canRevoke = invite.revoked_at === null && status.label === 'Active';
            return (
              <TableRow key={invite.id}>
                <TableCell>
                  <strong>{invite.label.length > 0 ? invite.label : 'Untitled invite'}</strong>
                  <div>
                    <small className="join-invite-id">{invite.id}</small>
                  </div>
                </TableCell>
                <TableCell>
                  {invite.use_count} / {invite.max_uses}
                </TableCell>
                <TableCell>
                  <StatusBadge label={status.label} status={status.status} />
                </TableCell>
                <TableCell>
                  {invite.expires_at === null ? (
                    <span>Never</span>
                  ) : (
                    <time dateTime={invite.expires_at}>{formatUtcDateTime(invite.expires_at)}</time>
                  )}
                </TableCell>
                <TableCell>
                  <time dateTime={invite.created_at}>{formatUtcDateTime(invite.created_at)}</time>
                </TableCell>
                <TableCell>
                  {canRevoke ? (
                    <form action={revokeAction}>
                      <input name="invite_id" type="hidden" value={invite.id} />
                      <button className="button-secondary" type="submit">
                        Revoke
                      </button>
                    </form>
                  ) : (
                    <span className="join-invite-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableShell>
  );
}

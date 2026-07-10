import { Badge } from './badge';

const statusTone = {
  active: 'success',
  success: 'success',
  approved: 'success',
  ready: 'success',
  pending: 'warning',
  warning: 'warning',
  queued: 'warning',
  draft: 'warning',
  blocked: 'danger',
  denied: 'danger',
  failed: 'danger',
  revoked: 'danger',
  inactive: 'outline',
  archived: 'outline',
  unverified: 'outline',
  observe: 'info',
  info: 'info',
} as const;

type StatusBadgeProps = {
  readonly status: string;
  readonly label?: string;
};

export function StatusBadge({ label, status }: StatusBadgeProps) {
  const key = status.toLowerCase() as keyof typeof statusTone;
  return <Badge variant={statusTone[key] ?? 'neutral'}>{label ?? status.replaceAll('_', ' ')}</Badge>;
}

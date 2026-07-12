import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { OrgAuditPanel } from '@/components/audit/OrgAuditPanel';
import { CHAIN_LABELS, formatMoney, formatOptionalRail, formatRail, titleCase } from '@/lib/payments-format';
import type { AuditEventRecord } from '@/lib/audit-types';
import type {
  CircleProviderJobRecord,
  PaymentEventRecord,
  PaymentReservationRecord,
  PaymentRouteObservationRecord,
} from '@/lib/payments-types';

type TreasuryActivityProps = {
  readonly auditEvents: readonly AuditEventRecord[];
  readonly paymentEvents: readonly PaymentEventRecord[];
  readonly providerJobs: readonly CircleProviderJobRecord[];
  readonly reservations: readonly PaymentReservationRecord[];
  readonly routeObservations: readonly PaymentRouteObservationRecord[];
};

function paymentStatus(event: PaymentEventRecord): { readonly label: string; readonly status: string } {
  const fulfillment = event.result.fulfillment;
  if (fulfillment !== null && typeof fulfillment === 'object') {
    const status = (fulfillment as Record<string, unknown>).status;
    if (status === 'delivered') return { label: 'Delivered', status: 'active' };
    if (status === 'failed') return { label: 'Fulfillment failed', status: 'failed' };
  }
  if (event.result.settlement === 'settled') return { label: 'Settled', status: 'active' };
  return { label: titleCase(event.decision), status: event.decision };
}

export function TreasuryActivity({ auditEvents, paymentEvents, providerJobs, reservations, routeObservations }: TreasuryActivityProps) {
  return (
    <div className="grid gap-6">
      <PageHeader description="Ledger, routing decisions, reservations, provider jobs, and audit evidence for every payment attempt." title="Activity & evidence" />

      <Card>
        <CardContent>
          <Tabs defaultValue="ledger">
            <TabsList>
              <TabsTrigger value="ledger">Ledger</TabsTrigger>
              <TabsTrigger value="routes">Routes</TabsTrigger>
              <TabsTrigger value="reservations">Reservations</TabsTrigger>
              <TabsTrigger value="jobs">Provider jobs</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>

            <TabsContent value="ledger">
              {paymentEvents.length === 0 ? (
                <EmptyState description="Approved and submitted x402 payments will be recorded here with audit evidence." title="No payment events" variant="activity" />
              ) : (
                <TableShell maxHeight={520}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment</TableHead>
                        <TableHead>Rail</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentEvents.map((event) => {
                        const status = paymentStatus(event);
                        return (
                        <TableRow key={event.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{event.resource_category ?? event.asset}</span>
                              <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatRail(event.rail)}</TableCell>
                          <TableCell className="tabular-nums">{formatMoney(event.amount_usdc)}</TableCell>
                          <TableCell>{titleCase(event.provider_mode)}</TableCell>
                          <TableCell>
                            <StatusBadge label={status.label} status={status.status} />
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>

            <TabsContent value="routes">
              {routeObservations.length === 0 ? (
                <EmptyState description="Agent payment attempts will appear here even when policy, liquidity, or rail readiness blocks them." title="No route observations" variant="activity" />
              ) : (
                <TableShell maxHeight={520}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Request</TableHead>
                        <TableHead>Selected rail</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {routeObservations.map((observation) => (
                        <TableRow key={observation.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{observation.resource_category ?? observation.requested_asset ?? 'x402 request'}</span>
                              <span className="text-xs text-muted-foreground">{observation.reason_code}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatOptionalRail(observation.supported_rail)}</TableCell>
                          <TableCell className="tabular-nums">{formatMoney(observation.amount_usdc)}</TableCell>
                          <TableCell>
                            <StatusBadge label={observation.outcome} status={observation.outcome === 'accepted' ? 'active' : 'pending'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>

            <TabsContent value="reservations">
              {reservations.length === 0 ? (
                <EmptyState description="Reservations appear when payment execution locks budget against an agent account." title="No reservations" variant="activity" />
              ) : (
                <TableShell maxHeight={520}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reservation</TableHead>
                        <TableHead>Rail</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reservations.map((reservation) => (
                        <TableRow key={reservation.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{reservation.reason_code}</span>
                              <span className="text-xs text-muted-foreground">{reservation.quote_hash.slice(0, 12)}...</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatRail(reservation.rail)}</TableCell>
                          <TableCell className="tabular-nums">{formatMoney(reservation.amount_usdc)}</TableCell>
                          <TableCell>
                            <StatusBadge label={reservation.status} status={reservation.status === 'settled' ? 'active' : 'pending'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>

            <TabsContent value="jobs">
              {providerJobs.length === 0 ? (
                <EmptyState description="Circle Agent Wallet sync, faucet, and Gateway deposit attempts will appear here." title="No provider jobs" variant="activity" />
              ) : (
                <TableShell maxHeight={520}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operation</TableHead>
                        <TableHead>Chain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {providerJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell>
                            <div className="grid gap-0.5">
                              <span className="font-semibold">{titleCase(job.job_type.replace('.', '_'))}</span>
                              <span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
                            </div>
                          </TableCell>
                          <TableCell>{job.chain === null ? 'Workspace' : CHAIN_LABELS[job.chain]}</TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">{job.error_code ?? job.provider_ref ?? 'Recorded'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableShell>
              )}
            </TabsContent>

            <TabsContent value="audit">
              <OrgAuditPanel
                description="Treasury setup, wallet funding, liquidity jobs, route decisions, and payment settlement evidence."
                domains={['payment', 'treasury', 'wallet']}
                events={auditEvents}
                title="Payment activity"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import type { ChatGraph } from '@/lib/server/agent-chat-client';

type FleetLiveGraphProps = {
  readonly graph: ChatGraph;
};

export function FleetLiveGraph({ graph }: FleetLiveGraphProps) {
  if (graph.nodes.length === 0) return null;

  const paymentEdges = graph.edges.filter((edge) => edge.kind === 'payment');
  const wireEdges = graph.edges.filter((edge) => edge.kind === 'wire');

  return (
    <div className="achat-graph" aria-label="Fleet graph">
      <div className="achat-graph-nodes">
        {graph.nodes.map((node, index) => (
          <div className="achat-graph-node-wrap" key={node.id}>
            <div className={`achat-graph-node is-${node.status}`}>
              <span className="achat-graph-node-label">{node.label}</span>
              <span className="achat-graph-node-status">{node.status}</span>
            </div>
            {index < graph.nodes.length - 1 ? (
              <span
                className={`achat-graph-wire is-${wireEdges[index]?.status ?? 'pending'}`}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
      {paymentEdges.length > 0 ? (
        <ul className="achat-graph-payments">
          {paymentEdges.map((edge) => {
            const from = graph.nodes.find((n) => n.id === edge.from)?.label ?? edge.from;
            const to = graph.nodes.find((n) => n.id === edge.to)?.label ?? edge.to;
            return (
              <li key={edge.id}>
                <span className="achat-graph-pay-dot" aria-hidden="true" />
                {from} → {to}
                {edge.label !== undefined ? ` · ${edge.label}` : ''}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

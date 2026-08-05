export function ChainStory() {
  return (
    <section className="aops-chain-section" id="treasury">
      <div className="aops-wrap aops-chain-canvas">
        <div className="aops-chain-intro">
          <div>
            <span>Multi-chain treasury</span>
            <h2>One treasury surface. Every execution path.</h2>
          </div>
          <p>
            Agents can execute across multiple chains while authority, liquidity controls,
            approvals, and evidence remain organization-owned.
          </p>
        </div>

        <div className="aops-treasury-boundary" data-treasury-boundary>
          <header className="aops-authority-layer">
            <div>
              <span>Organization-owned authority</span>
              <strong>Policy · Limits · Approvals</strong>
            </div>
            <small>Applied before execution</small>
          </header>

          <div className="aops-treasury-flow">
            <div className="aops-treasury-core">
              <i aria-hidden="true"><b /></i>
              <span>Route-aware liquidity</span>
              <strong>AOPS Treasury</strong>
              <small>One operational balance</small>
            </div>

            <div className="aops-execution-routes">
              <article>
                <b>01</b>
                <div>
                  <span>Chain-native path</span>
                  <strong>Exact settlement</strong>
                </div>
                <small>Dedicated wallet</small>
              </article>
              <article>
                <b>02</b>
                <div>
                  <span>Unified path</span>
                  <strong>Gateway liquidity</strong>
                </div>
                <small>Shared balance</small>
              </article>
            </div>
          </div>

          <footer className="aops-evidence-layer">
            <span>One evidence trail</span>
            <p><b>Request</b><i /><b>Decision</b><i /><b>Settlement</b><i /><b>Proof</b></p>
          </footer>
        </div>
      </div>
    </section>
  );
}

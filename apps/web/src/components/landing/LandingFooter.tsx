import Image from 'next/image';
import Link from 'next/link';

export function LandingFooter() {
  return (
    <footer aria-label="AOPS footer" className="aops-footer">
      <div className="aops-wrap aops-footer-top">
        <div>
          <span>AOPS</span>
          <p>Authority for agents that act across production systems.</p>
        </div>
        <nav aria-label="Footer navigation">
          <div><strong>Product</strong><a href="#product">Control model</a><a href="#treasury">USDC treasury</a><a href="#security">Security</a></div>
          <div><strong>Build</strong><a href="#developers">API and MCP</a><a href="#workflow">Operating flow</a></div>
          <div><strong>Access</strong><Link href="/auth">Sign in</Link><Link href="/auth">Start with AOPS</Link></div>
        </nav>
      </div>
      <a className="aops-footer-wordmark" href="#top" aria-label="Back to top">
        <Image alt="AOPS" height={666} src="/landing/aops-wordmark.png" unoptimized width={1000} />
      </a>
      <div className="aops-wrap aops-footer-bottom">
        <span>Testnet treasury</span>
        <span>Identity · Policy · Approvals · Evidence</span>
        <span>© 2026 AOPS</span>
      </div>
    </footer>
  );
}

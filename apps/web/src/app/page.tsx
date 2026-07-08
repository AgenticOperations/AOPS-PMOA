import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="public-landing">
      <section className="landing-mark" aria-labelledby="landing-title">
        <p className="landing-kicker">Agent finance operations</p>
        <h1 id="landing-title">agentOps</h1>
        <p>One control plane for agent identity, access credentials, policy, payments, and evidence.</p>
        <Link className="button-primary landing-cta" href="/auth">
          Get started
        </Link>
      </section>
    </main>
  );
}

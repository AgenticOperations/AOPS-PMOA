'use client';

import { useState } from 'react';

/**
 * A deposit address that is meant to be copied, not read.
 *
 * Truncated on screen but copied in full, with the untruncated value in the
 * title -- an operator pasting a hand-retyped address loses real money.
 */
export function CopyableAddress({ address }: { readonly address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="funding-address"
      title={address}
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <code>{address.slice(0, 10)}…{address.slice(-6)}</code>
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

type Props = {
  readonly trusted: boolean;
};

/**
 * The checkmark that separates the two payment rails. Meaning lives in the
 * text and `aria-label`, not colour alone -- a screen reader or a
 * colour-blind operator must get the same signal as anyone else.
 */
export function TrustedBadge({ trusted }: Props) {
  if (trusted) {
    return (
      <span aria-label="Trusted" className="trusted-badge trusted-badge-trusted">
        ✓ Trusted
      </span>
    );
  }
  return (
    <span aria-label="Not trusted" className="trusted-badge trusted-badge-untrusted">
      Not trusted
    </span>
  );
}

/**
 * Maps Circle / API delegation failures to operator-facing copy.
 * Raw Circle strings like "the asset amount owned by the wallet is
 * insufficient for the transaction" are especially misleading when the
 * explorer already shows USDC/ETH — Circle's wallet indexer often cannot
 * see externally deposited gas yet.
 */

const GAS_INDEXER_HINT =
  'We are working with the Arc team on this: their / Circle wallet indexer often cannot see gas on the submitting wallet yet, even when explorers show a balance. Prefer From treasury on Arc testnet, or retry after gas is Circle-visible.';

export function isGasIndexerInsufficientMessage(message: string | undefined): boolean {
  if (message === undefined || message.length === 0) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('asset amount owned by the wallet is insufficient')
    || lower.includes('insufficient for the transaction')
  );
}

export function formatDelegationFailure(input: {
  readonly error?: string | undefined;
  readonly message?: string | undefined;
}): string {
  const code = input.error?.trim() ?? '';
  const message = input.message?.trim() ?? '';

  if (code === 'agent_wallet_not_found') {
    return 'This agent has no wallet on the selected chain yet. Grant access first, then wait for provisioning.';
  }
  if (code === 'org_delegation_ceiling_exceeded') {
    return 'This cap would exceed the org ceiling. Raise it under Fund → Org ceiling, or revoke an unused delegation.';
  }
  if (code === 'treasury_insufficient_for_ceiling') {
    return 'Treasury does not hold enough USDC for this cap. Deposit on Fund, then try again.';
  }

  if (
    code === 'delegation_gas_indexer_pending'
    || isGasIndexerInsufficientMessage(message)
    || isGasIndexerInsufficientMessage(code)
  ) {
    return `Delegation could not be recorded on-chain. ${GAS_INDEXER_HINT}`;
  }

  if (message.length > 0) return message;
  if (code === 'delegation_record_failed') {
    return 'The delegation could not be recorded.';
  }
  if (code.length > 0) return code;
  return 'The delegation could not be created.';
}

/** Parse a failed fetch body that may be JSON or plain text. */
export function formatDelegationFailureFromBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return formatDelegationFailure({});
  try {
    const parsed = JSON.parse(trimmed) as { error?: string; message?: string };
    if (typeof parsed === 'object' && parsed !== null) {
      return formatDelegationFailure({
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
      });
    }
  } catch {
    // plain text
  }
  if (isGasIndexerInsufficientMessage(trimmed)) {
    return formatDelegationFailure({ message: trimmed });
  }
  return trimmed;
}

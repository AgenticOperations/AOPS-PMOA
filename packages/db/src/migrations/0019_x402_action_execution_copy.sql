UPDATE policy_action_registry
   SET description = 'Control whether an agent may execute a supported x402 USDC payment through agentOps.'
 WHERE action_id = 'payment.x402.authorize';

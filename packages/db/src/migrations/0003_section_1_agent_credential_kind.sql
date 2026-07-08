DO $$
DECLARE
  kind_constraint_name text;
BEGIN
  SELECT conname
    INTO kind_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'connections'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%kind%'
     AND pg_get_constraintdef(oid) LIKE '%manual_observe%'
   LIMIT 1;

  IF kind_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE connections DROP CONSTRAINT %I', kind_constraint_name);
  END IF;
END $$;

ALTER TABLE connections
  ADD CONSTRAINT connections_kind_check
  CHECK (
    kind IN (
      'agent_credential',
      'mcp_local',
      'mcp_remote',
      'mcp_http',
      'api_key',
      'sdk',
      'cli',
      'proxy',
      'manual_observe'
    )
  );

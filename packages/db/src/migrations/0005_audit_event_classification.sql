ALTER TABLE audit_events
  ADD COLUMN event_domain text NOT NULL DEFAULT 'system',
  ADD COLUMN event_category text NOT NULL DEFAULT 'configuration',
  ADD COLUMN severity text NOT NULL DEFAULT 'info',
  ADD COLUMN tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN related_agent_id text,
  ADD COLUMN related_team_id text,
  ADD COLUMN related_connection_id text,
  ADD COLUMN related_wallet_ref_id text,
  ADD COLUMN related_policy_id text,
  ADD COLUMN related_wallet_id text;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_severity_check
  CHECK (severity IN ('info', 'warning', 'critical'));

UPDATE audit_events
   SET event_domain = CASE
         WHEN action LIKE 'org.%' OR action LIKE 'team.%' OR action LIKE 'agent.%' OR action LIKE 'onboarding.%'
           THEN 'identity'
         WHEN action LIKE 'connection.%'
           THEN 'credential'
         WHEN action LIKE 'wallet_ref.%'
           THEN 'wallet'
         ELSE 'system'
       END,
       event_category = 'configuration',
       tags = ARRAY_REMOVE(ARRAY[
         'section_1',
         CASE
           WHEN action LIKE 'connection.%' THEN 'credential'
           WHEN action LIKE 'wallet_ref.%' THEN 'wallet_ref'
           WHEN action LIKE 'agent.%' THEN 'agent'
           WHEN action LIKE 'team.%' THEN 'team'
           WHEN action LIKE 'org.%' THEN 'org'
           ELSE NULL
         END
       ], NULL);

UPDATE audit_events
   SET related_agent_id = resource_id
 WHERE resource_type = 'agent';

UPDATE audit_events ae
   SET related_connection_id = c.id,
       related_agent_id = c.agent_id
  FROM connections c
 WHERE ae.org_id = c.org_id
   AND ae.resource_type = 'connection'
   AND ae.resource_id = c.id;

UPDATE audit_events ae
   SET related_wallet_ref_id = w.id,
       related_agent_id = w.agent_id
  FROM wallet_refs w
 WHERE ae.org_id = w.org_id
   AND ae.resource_type = 'wallet_ref'
   AND ae.resource_id = w.id;

UPDATE audit_events
   SET related_team_id = resource_id
 WHERE resource_type = 'team';

CREATE INDEX audit_events_org_domain_category_idx
  ON audit_events (org_id, event_domain, event_category, recorded_at DESC);

CREATE INDEX audit_events_org_related_agent_idx
  ON audit_events (org_id, related_agent_id, recorded_at DESC)
  WHERE related_agent_id IS NOT NULL;

CREATE INDEX audit_events_org_related_connection_idx
  ON audit_events (org_id, related_connection_id, recorded_at DESC)
  WHERE related_connection_id IS NOT NULL;

CREATE INDEX audit_events_org_tags_idx
  ON audit_events USING gin (tags);

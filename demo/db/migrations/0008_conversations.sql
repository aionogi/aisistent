-- Durable conversation records: one row per call or message thread and its
-- transcript, visible to the organization's members, deletable by owners and
-- admins, removed after the organization's retention period, and included in
-- the organization export.
--
-- Only the future ingestion path (M4: telephony and messaging) creates
-- records. app.record_conversation() is therefore granted to no role here;
-- the web runtime can read and delete but never fabricate conversations.

-- How long conversations are kept; owners change it (default 90 days).
ALTER TABLE app.organizations
  ADD COLUMN conversation_retention_days integer NOT NULL DEFAULT 90
  CHECK (conversation_retention_days BETWEEN 7 AND 730);

CREATE TABLE app.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('call', 'message')),
  outcome text NOT NULL CHECK (outcome IN ('booked', 'answered', 'handoff', 'unanswered')),
  customer_name text CHECK (customer_name IS NULL OR length(btrim(customer_name)) BETWEEN 1 AND 120),
  customer_contact text CHECK (customer_contact IS NULL OR length(btrim(customer_contact)) BETWEEN 1 AND 120),
  summary text CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 2000),
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= started_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE INDEX conversations_org_started_idx ON app.conversations (organization_id, started_at DESC);
CREATE INDEX conversations_started_idx ON app.conversations (started_at);

-- The organization id is repeated so RLS needs no join; the composite key
-- keeps it equal to the conversation's.
CREATE TABLE app.conversation_messages (
  conversation_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 500),
  speaker text NOT NULL CHECK (speaker IN ('assistant', 'customer', 'team')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  spoken_at timestamptz,
  PRIMARY KEY (conversation_id, position),
  FOREIGN KEY (conversation_id, organization_id) REFERENCES app.conversations (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX conversation_messages_org_idx ON app.conversation_messages (organization_id);

ALTER TABLE app.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_read ON app.conversations FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IS NOT NULL);
CREATE POLICY conversations_delete ON app.conversations FOR DELETE TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY conversation_messages_read ON app.conversation_messages FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IS NOT NULL);

GRANT SELECT, DELETE ON app.conversations TO aisistent_runtime;
GRANT SELECT ON app.conversation_messages TO aisistent_runtime;

-- Stores one finished conversation and its transcript. `record` holds channel,
-- outcome, optional customer_name, customer_contact and summary, started_at,
-- optional ended_at, and messages: [{speaker, body, spoken_at?}] in order.
CREATE FUNCTION app.record_conversation(target_organization uuid, record jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    created uuid;
    messages jsonb := coalesce(record -> 'messages', '[]'::jsonb);
  BEGIN
    IF jsonb_typeof(messages) <> 'array' OR jsonb_array_length(messages) > 500 THEN
      RAISE EXCEPTION 'invalid_messages' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.conversations (organization_id, channel, outcome, customer_name, customer_contact, summary, started_at, ended_at)
      VALUES (target_organization, record ->> 'channel', record ->> 'outcome',
        nullif(btrim(record ->> 'customer_name'), ''), nullif(btrim(record ->> 'customer_contact'), ''), nullif(btrim(record ->> 'summary'), ''),
        (record ->> 'started_at')::timestamptz, (record ->> 'ended_at')::timestamptz)
      RETURNING id INTO created;
    INSERT INTO app.conversation_messages (conversation_id, organization_id, position, speaker, body, spoken_at)
      SELECT created, target_organization, item.position::integer, item.message ->> 'speaker', btrim(item.message ->> 'body'), (item.message ->> 'spoken_at')::timestamptz
      FROM jsonb_array_elements(messages) WITH ORDINALITY AS item (message, position);
    RETURN created;
  END
  $$;
REVOKE ALL ON FUNCTION app.record_conversation(uuid, jsonb) FROM PUBLIC;

-- Owners set how many days conversations are kept (7 to 730).
CREATE FUNCTION app.set_conversation_retention(days integer) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    previous integer;
  BEGIN
    IF days IS NULL OR days NOT BETWEEN 7 AND 730 THEN
      RAISE EXCEPTION 'invalid_retention' USING ERRCODE = '22023';
    END IF;
    SELECT conversation_retention_days INTO previous FROM app.organizations WHERE id = org;
    IF previous = days THEN
      RETURN;
    END IF;
    UPDATE app.organizations SET conversation_retention_days = days WHERE id = org;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'organization.retention_change', previous || '→' || days, 'success');
  END
  $$;

-- Deletes at most batch_size conversations older than their organization's
-- retention period, oldest first; run by the cleanup job.
CREATE FUNCTION app.purge_expired_conversations(batch_size integer DEFAULT 500) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app, pg_temp
  AS $$
  DECLARE
    removed integer;
  BEGIN
    IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'invalid_cleanup_batch_size' USING ERRCODE = '22023';
    END IF;
    WITH expired AS (
      SELECT conversation.id FROM app.conversations AS conversation
        JOIN app.organizations AS organization ON organization.id = conversation.organization_id
        WHERE conversation.started_at < clock_timestamp() - make_interval(days => organization.conversation_retention_days)
        ORDER BY conversation.started_at, conversation.id LIMIT batch_size FOR UPDATE OF conversation SKIP LOCKED
    )
    DELETE FROM app.conversations AS conversation USING expired WHERE conversation.id = expired.id;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;

-- The export from migration 0006, now with retention and conversations.
CREATE OR REPLACE FUNCTION app.export_organization() RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    document jsonb;
  BEGIN
    SELECT jsonb_build_object(
      'organization', (SELECT jsonb_build_object('name', o.name, 'createdAt', o.created_at, 'conversationRetentionDays', o.conversation_retention_days) FROM app.organizations o WHERE o.id = org),
      'members', coalesce((
        SELECT jsonb_agg(jsonb_build_object('name', u.display_name, 'email', u.email, 'role', m.role, 'joinedAt', m.created_at)
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at, u.id)
        FROM app.memberships m JOIN app.users u ON u.id = m.user_id WHERE m.organization_id = org), '[]'::jsonb),
      'invitations', coalesce((
        SELECT jsonb_agg(jsonb_build_object('email', i.email, 'role', i.role, 'createdAt', i.created_at, 'expiresAt', i.expires_at, 'acceptedAt', i.accepted_at, 'revokedAt', i.revoked_at) ORDER BY i.created_at, i.id)
        FROM app.invitations i WHERE i.organization_id = org), '[]'::jsonb),
      'assistantConfig', (
        SELECT jsonb_build_object('config', c.config, 'revision', c.revision, 'updatedAt', c.updated_at)
        FROM app.assistant_configs c WHERE c.organization_id = org),
      'knowledge', coalesce((
        SELECT jsonb_agg(jsonb_build_object('question', k.question, 'answer', k.answer, 'createdAt', k.created_at, 'updatedAt', k.updated_at) ORDER BY k.created_at, k.id)
        FROM app.knowledge_entries k WHERE k.organization_id = org), '[]'::jsonb),
      'conversations', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'channel', c.channel, 'outcome', c.outcome, 'customerName', c.customer_name, 'customerContact', c.customer_contact,
            'summary', c.summary, 'startedAt', c.started_at, 'endedAt', c.ended_at,
            'messages', coalesce((
              SELECT jsonb_agg(jsonb_build_object('speaker', m.speaker, 'body', m.body, 'spokenAt', m.spoken_at) ORDER BY m.position)
              FROM app.conversation_messages m WHERE m.conversation_id = c.id), '[]'::jsonb))
          ORDER BY c.started_at, c.id)
        FROM app.conversations c WHERE c.organization_id = org), '[]'::jsonb),
      'activity', coalesce((
        SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'actor', coalesce(u.display_name, u.email), 'action', a.action, 'target', a.target, 'result', a.result) ORDER BY a.created_at, a.id)
        FROM app.audit_events a LEFT JOIN app.users u ON u.id = a.actor_user_id WHERE a.organization_id = org), '[]'::jsonb)
    ) INTO document;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, result)
      VALUES (org, app.current_user_id(), 'organization.export', 'success');
    RETURN document;
  END
  $$;

REVOKE ALL ON FUNCTION app.set_conversation_retention(integer), app.purge_expired_conversations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_conversation_retention(integer), app.purge_expired_conversations(integer) TO aisistent_runtime;

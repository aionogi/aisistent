-- M4 step 2: a chat that firms embed on their own websites. Visitors write to
-- the firm's assistant; the conversations appear in the firm's workspace with
-- channel 'web', under the firm's retention, export and deletion.
--
-- Visitors have no accounts. A widget is addressed by a random public id
-- (it appears in the firm's embed code, so it is not a secret), and each
-- visitor conversation by a random token that only the visitor's browser
-- holds; the database keeps the token's SHA-256 hash. The web runtime reaches
-- visitor data only through the functions below, which never return another
-- conversation, a list of conversations or any person's data.

ALTER TABLE app.conversations DROP CONSTRAINT conversations_channel_check;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('call', 'message', 'test', 'web'));

CREATE TABLE app.site_chat_settings (
  organization_id uuid PRIMARY KEY REFERENCES app.organizations (id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[0-9a-f]{20}$'),
  enabled boolean NOT NULL DEFAULT false,
  allowed_origins text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allowed_origins) <= 5),
  daily_message_limit integer NOT NULL DEFAULT 300 CHECK (daily_message_limit BETWEEN 10 AND 5000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users (id) ON DELETE SET NULL
);

CREATE TABLE app.site_chat_threads (
  conversation_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  off_topic_streak integer NOT NULL DEFAULT 0 CHECK (off_topic_streak >= 0),
  ended boolean NOT NULL DEFAULT false,
  FOREIGN KEY (conversation_id, organization_id) REFERENCES app.conversations (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX site_chat_threads_org_idx ON app.site_chat_threads (organization_id);

-- The runtime reads the settings of its own organization; threads only through the functions.
ALTER TABLE app.site_chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.site_chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_chat_settings_read ON app.site_chat_settings FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IS NOT NULL);
GRANT SELECT ON app.site_chat_settings TO aisistent_runtime;

-- Owners and admins turn the chat on or off, choose the websites that may show
-- it and the firm's daily message limit. Returns the widget's public id.
-- Origins arrive normalized from the application and are checked again here.
CREATE FUNCTION app.set_site_chat(enable boolean, origins text[], daily_limit integer) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_editor();
    -- The first 12 hex digits of a random UUID are all random: 80 random bits in total.
    created text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    result text;
  BEGIN
    IF enable IS NULL OR origins IS NULL OR daily_limit IS NULL OR daily_limit NOT BETWEEN 10 AND 5000
      OR cardinality(origins) > 5 OR array_position(origins, NULL) IS NOT NULL
      OR EXISTS (SELECT 1 FROM unnest(origins) AS origin
        WHERE length(origin) > 260 OR origin !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
          -- A numeric last label is an IP address, not a website name.
          OR origin ~ '\.[0-9]+$')
      OR (enable AND cardinality(origins) = 0) THEN
      RAISE EXCEPTION 'invalid_site_chat' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.site_chat_settings AS settings (organization_id, public_id, enabled, allowed_origins, daily_message_limit, updated_by)
      VALUES (org, created, enable, origins, daily_limit, app.current_user_id())
      ON CONFLICT (organization_id) DO UPDATE SET
        enabled = excluded.enabled, allowed_origins = excluded.allowed_origins, daily_message_limit = excluded.daily_message_limit,
        updated_at = now(), updated_by = excluded.updated_by
      RETURNING settings.public_id INTO result;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'site_chat.change', CASE WHEN enable THEN 'on' ELSE 'off' END, 'success');
    RETURN result;
  END
  $$;

-- The websites that may frame a widget, for its page's Content-Security-Policy.
-- Also for a widget that is off, so the firm's site shows "not available"
-- instead of a blocked frame; null for an unknown id.
CREATE FUNCTION app.site_chat_frame(widget text) RETURNS text[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT allowed_origins FROM app.site_chat_settings WHERE public_id = widget
  $$;

-- What an enabled widget needs to answer: the firm's assistant settings and
-- knowledge (which it publishes to its customers anyway) and its daily limit.
-- No row when the widget is off or unknown.
CREATE FUNCTION app.site_chat_open(widget text)
  RETURNS TABLE (organization_id uuid, daily_message_limit integer, config jsonb, config_updated_at timestamptz, knowledge jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.organization_id, s.daily_message_limit, c.config, c.updated_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'question', k.question, 'answer', k.answer) ORDER BY k.created_at, k.id)
        FROM app.knowledge_entries k WHERE k.organization_id = s.organization_id), '[]'::jsonb)
    FROM app.site_chat_settings s
    LEFT JOIN app.assistant_configs c ON c.organization_id = s.organization_id
    WHERE s.public_id = widget AND s.enabled
  $$;

-- One visitor's conversation, found by its token hash within an enabled
-- widget: {ended, offTopicStreak, messages: [{speaker, body}]}, or null.
CREATE FUNCTION app.site_chat_thread(widget text, visitor_hash bytea) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT jsonb_build_object(
      'ended', t.ended,
      'offTopicStreak', t.off_topic_streak,
      'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('speaker', m.speaker, 'body', m.body) ORDER BY m.position)
        FROM app.conversation_messages m WHERE m.conversation_id = t.conversation_id), '[]'::jsonb))
    FROM app.site_chat_threads t
    JOIN app.site_chat_settings s ON s.organization_id = t.organization_id
    WHERE s.public_id = widget AND s.enabled AND t.token_hash = visitor_hash
  $$;

-- Appends messages ([{speaker: 'customer' | 'assistant', body}]) to the
-- visitor's conversation. expected_count is the number of messages the caller
-- read: 0 creates the conversation, and a count other than the stored one
-- means another request answered meanwhile ('thread_changed'). off_topic
-- extends or resets the run of unrelated messages; end_thread closes the
-- conversation for good. Returns the new number of messages, at most 40.
CREATE FUNCTION app.site_chat_append(widget text, visitor_hash bytea, expected_count integer, messages jsonb, off_topic boolean, end_thread boolean) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid;
    conversation uuid;
    used integer;
    closed boolean;
    first_question text;
  BEGIN
    SELECT organization_id INTO org FROM app.site_chat_settings WHERE public_id = widget AND enabled;
    IF org IS NULL THEN
      RAISE EXCEPTION 'site_chat_unavailable' USING ERRCODE = '42501';
    END IF;
    IF visitor_hash IS NULL OR octet_length(visitor_hash) <> 32 OR expected_count IS NULL OR expected_count < 0
      OR off_topic IS NULL OR end_thread IS NULL
      OR messages IS NULL OR jsonb_typeof(messages) <> 'array' OR jsonb_array_length(messages) NOT BETWEEN 1 AND 3
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(messages) AS item (message)
        WHERE jsonb_typeof(item.message) <> 'object'
          OR coalesce(item.message ->> 'speaker', '') NOT IN ('customer', 'assistant')
          OR length(btrim(coalesce(item.message ->> 'body', ''))) NOT BETWEEN 1 AND 2000) THEN
      RAISE EXCEPTION 'invalid_messages' USING ERRCODE = '22023';
    END IF;

    -- The row lock serializes concurrent appends to one conversation.
    SELECT t.conversation_id, t.ended INTO conversation, closed FROM app.site_chat_threads t
      WHERE t.token_hash = visitor_hash AND t.organization_id = org FOR UPDATE;
    IF conversation IS NULL THEN
      IF expected_count <> 0 THEN
        RAISE EXCEPTION 'thread_changed' USING ERRCODE = '40001';
      END IF;
      first_question := (SELECT left(btrim(item.message ->> 'body'), 200) FROM jsonb_array_elements(messages) WITH ORDINALITY AS item (message, position)
        WHERE item.message ->> 'speaker' = 'customer' ORDER BY item.position LIMIT 1);
      INSERT INTO app.conversations (organization_id, channel, outcome, summary, started_at, ended_at)
        VALUES (org, 'web', 'answered', nullif(first_question, ''), clock_timestamp(), clock_timestamp())
        RETURNING id INTO conversation;
      -- A token already used with another firm's widget fails on the unique hash.
      INSERT INTO app.site_chat_threads (conversation_id, organization_id, token_hash) VALUES (conversation, org, visitor_hash);
      used := 0;
    ELSE
      IF closed THEN
        RAISE EXCEPTION 'thread_ended' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(max(position), 0) INTO used FROM app.conversation_messages WHERE conversation_id = conversation;
      IF used <> expected_count THEN
        RAISE EXCEPTION 'thread_changed' USING ERRCODE = '40001';
      END IF;
      UPDATE app.conversations SET ended_at = clock_timestamp() WHERE id = conversation;
    END IF;

    IF used + jsonb_array_length(messages) > 40 THEN
      RAISE EXCEPTION 'thread_full' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.conversation_messages (conversation_id, organization_id, position, speaker, body, spoken_at)
      SELECT conversation, org, used + item.position::integer, item.message ->> 'speaker', btrim(item.message ->> 'body'), clock_timestamp()
      FROM jsonb_array_elements(messages) WITH ORDINALITY AS item (message, position);
    UPDATE app.site_chat_threads
      SET off_topic_streak = CASE WHEN off_topic THEN off_topic_streak + 1 ELSE 0 END, ended = end_thread
      WHERE conversation_id = conversation;
    RETURN used + jsonb_array_length(messages);
  END
  $$;

-- Adds one provider request made for an enabled widget to today's totals.
CREATE FUNCTION app.record_site_chat_usage(widget text, request_input_tokens integer, request_output_tokens integer, request_cost_microdollars bigint) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.site_chat_settings WHERE public_id = widget AND enabled) THEN
      RAISE EXCEPTION 'site_chat_unavailable' USING ERRCODE = '42501';
    END IF;
    IF request_input_tokens IS NULL OR request_output_tokens IS NULL OR request_cost_microdollars IS NULL
      OR request_input_tokens < 0 OR request_output_tokens < 0 OR request_cost_microdollars < 0 THEN
      RAISE EXCEPTION 'invalid_usage' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.assistant_daily_spend AS spend (usage_day, requests, input_tokens, output_tokens, cost_microdollars)
      VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date, 1, request_input_tokens, request_output_tokens, request_cost_microdollars)
      ON CONFLICT (usage_day) DO UPDATE SET
        requests = spend.requests + 1,
        input_tokens = spend.input_tokens + excluded.input_tokens,
        output_tokens = spend.output_tokens + excluded.output_tokens,
        cost_microdollars = spend.cost_microdollars + excluded.cost_microdollars;
  END
  $$;

-- The export from migration 0008, now with the website chat settings.
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
      'siteChat', (
        SELECT jsonb_build_object('enabled', s.enabled, 'allowedOrigins', to_jsonb(s.allowed_origins), 'dailyMessageLimit', s.daily_message_limit, 'updatedAt', s.updated_at)
        FROM app.site_chat_settings s WHERE s.organization_id = org),
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

REVOKE ALL ON FUNCTION app.set_site_chat(boolean, text[], integer), app.site_chat_frame(text), app.site_chat_open(text),
  app.site_chat_thread(text, bytea), app.site_chat_append(text, bytea, integer, jsonb, boolean, boolean),
  app.record_site_chat_usage(text, integer, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_site_chat(boolean, text[], integer), app.site_chat_frame(text), app.site_chat_open(text),
  app.site_chat_thread(text, bytea), app.site_chat_append(text, bytea, integer, jsonb, boolean, boolean),
  app.record_site_chat_usage(text, integer, integer, bigint) TO aisistent_runtime;

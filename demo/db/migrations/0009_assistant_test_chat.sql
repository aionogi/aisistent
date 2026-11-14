-- M4, step 1: owners and admins test their assistant in a text chat from the
-- workspace. Test conversations are stored like other conversations (members
-- read them, owners and admins delete them, the organization's retention and
-- export apply) with channel 'test'.
--
-- The web runtime may create and extend only test conversations, and only in
-- an organization where the current user is an owner or admin. It still
-- cannot fabricate calls or messages: app.record_conversation() stays
-- ungranted until telephony and messaging arrive.
--
-- Spending on the AI provider is counted per UTC day for the server-wide
-- daily budget. The counter holds totals only, nothing about a person or an
-- organization.

ALTER TABLE app.conversations DROP CONSTRAINT conversations_channel_check;
ALTER TABLE app.conversations ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('call', 'message', 'test'));

-- Owner or admin of the current organization, or an error.
CREATE FUNCTION app.require_editor() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
  BEGIN
    IF org IS NULL OR app.current_user_id() IS NULL OR coalesce(app.member_role(org), '') NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'editor_required' USING ERRCODE = '42501';
    END IF;
    RETURN org;
  END
  $$;

-- Appends messages ([{speaker: 'customer' | 'assistant', body}], in order) to
-- a test conversation of the current organization, creating it when
-- target_conversation is null. Returns the conversation id. A test
-- conversation holds at most 60 messages.
CREATE FUNCTION app.append_test_messages(target_conversation uuid, messages jsonb) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_editor();
    conversation uuid := target_conversation;
    used integer;
    first_question text;
  BEGIN
    IF messages IS NULL OR jsonb_typeof(messages) <> 'array' OR jsonb_array_length(messages) NOT BETWEEN 1 AND 4 THEN
      RAISE EXCEPTION 'invalid_messages' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(messages) AS item (message)
      WHERE jsonb_typeof(item.message) <> 'object'
        OR coalesce(item.message ->> 'speaker', '') NOT IN ('customer', 'assistant')
        OR length(btrim(coalesce(item.message ->> 'body', ''))) NOT BETWEEN 1 AND 4000
    ) THEN
      RAISE EXCEPTION 'invalid_messages' USING ERRCODE = '22023';
    END IF;

    IF conversation IS NULL THEN
      first_question := (SELECT left(btrim(item.message ->> 'body'), 200) FROM jsonb_array_elements(messages) WITH ORDINALITY AS item (message, position)
        WHERE item.message ->> 'speaker' = 'customer' ORDER BY item.position LIMIT 1);
      INSERT INTO app.conversations (organization_id, channel, outcome, summary, started_at, ended_at)
        VALUES (org, 'test', 'answered', nullif(first_question, ''), clock_timestamp(), clock_timestamp())
        RETURNING id INTO conversation;
      used := 0;
    ELSE
      -- The row lock serializes concurrent appends to one conversation.
      PERFORM 1 FROM app.conversations WHERE id = conversation AND organization_id = org AND channel = 'test' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'conversation_not_found' USING ERRCODE = '42501';
      END IF;
      SELECT coalesce(max(position), 0) INTO used FROM app.conversation_messages WHERE conversation_id = conversation;
      UPDATE app.conversations SET ended_at = clock_timestamp() WHERE id = conversation;
    END IF;

    IF used + jsonb_array_length(messages) > 60 THEN
      RAISE EXCEPTION 'conversation_full' USING ERRCODE = '22023';
    END IF;
    INSERT INTO app.conversation_messages (conversation_id, organization_id, position, speaker, body, spoken_at)
      SELECT conversation, org, used + item.position::integer, item.message ->> 'speaker', btrim(item.message ->> 'body'), clock_timestamp()
      FROM jsonb_array_elements(messages) WITH ORDINALITY AS item (message, position);
    RETURN conversation;
  END
  $$;

CREATE TABLE app.assistant_daily_spend (
  usage_day date PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_microdollars bigint NOT NULL DEFAULT 0 CHECK (cost_microdollars >= 0)
);
-- No direct access for the runtime; the two functions below are the only way in.
ALTER TABLE app.assistant_daily_spend ENABLE ROW LEVEL SECURITY;

-- True while today's (UTC) recorded spending is below the limit.
CREATE FUNCTION app.assistant_budget_available(limit_microdollars bigint) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT limit_microdollars > 0 AND coalesce((
      SELECT cost_microdollars FROM app.assistant_daily_spend WHERE usage_day = (clock_timestamp() AT TIME ZONE 'UTC')::date
    ), 0) < limit_microdollars
  $$;

-- Adds one provider request to today's totals; only an editor's request counts.
CREATE FUNCTION app.record_assistant_usage(request_input_tokens integer, request_output_tokens integer, request_cost_microdollars bigint) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  BEGIN
    PERFORM app.require_editor();
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

REVOKE ALL ON FUNCTION app.require_editor(), app.append_test_messages(uuid, jsonb), app.assistant_budget_available(bigint), app.record_assistant_usage(integer, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.append_test_messages(uuid, jsonb), app.assistant_budget_available(bigint), app.record_assistant_usage(integer, integer, bigint) TO aisistent_runtime;

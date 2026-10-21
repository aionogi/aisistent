-- Server-side sign-in sessions for the Auth0 SDK's stateful session store.
--
-- The browser cookie holds only an encrypted session id. Here the id is kept
-- as a SHA-256 hash and the session payload (user claims and tokens) as
-- AES-256-GCM ciphertext produced by the application, so a database read
-- alone reveals neither a usable session id nor tokens.
--
-- The runtime role has no direct table access; it uses the SECURITY DEFINER
-- functions below, which can only address a session by its hash or, for
-- back-channel logout, by the identity provider's subject and session id.

CREATE TABLE app.auth_sessions (
  id_hash bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  provider_session_id text CHECK (provider_session_id IS NULL OR length(provider_session_id) <= 255),
  payload bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_subject_idx ON app.auth_sessions (subject);
CREATE INDEX auth_sessions_provider_session_idx ON app.auth_sessions (provider_session_id) WHERE provider_session_id IS NOT NULL;
CREATE INDEX auth_sessions_expires_idx ON app.auth_sessions (expires_at);
ALTER TABLE app.auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.auth_session_get(session_hash bytea) RETURNS bytea
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.payload FROM app.auth_sessions s
    WHERE s.id_hash = session_hash AND s.expires_at > now()
  $$;

CREATE FUNCTION app.auth_session_put(session_hash bytea, session_subject text, session_provider_id text, session_payload bytea, session_expires timestamptz) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    INSERT INTO app.auth_sessions AS s (id_hash, subject, provider_session_id, payload, expires_at)
    VALUES (session_hash, session_subject, session_provider_id, session_payload, session_expires)
    ON CONFLICT (id_hash) DO UPDATE
      SET subject = excluded.subject,
          provider_session_id = excluded.provider_session_id,
          payload = excluded.payload,
          expires_at = excluded.expires_at,
          updated_at = now()
  $$;

-- Updates only an existing, unexpired session; returns whether one was found.
CREATE FUNCTION app.auth_session_update(session_hash bytea, session_payload bytea, session_expires timestamptz) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  BEGIN
    UPDATE app.auth_sessions
      SET payload = session_payload, expires_at = session_expires, updated_at = now()
      WHERE id_hash = session_hash AND expires_at > now();
    RETURN FOUND;
  END
  $$;

CREATE FUNCTION app.auth_session_delete(session_hash bytea) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ DELETE FROM app.auth_sessions WHERE id_hash = session_hash $$;

-- Back-channel logout: the identity provider names a session (sid), a user
-- (sub), or both. With both, only that user's matching session is removed.
CREATE FUNCTION app.auth_session_delete_for_logout(logout_subject text, logout_provider_session_id text) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    removed integer;
  BEGIN
    IF logout_subject IS NULL AND logout_provider_session_id IS NULL THEN
      RETURN 0;
    END IF;
    DELETE FROM app.auth_sessions
      WHERE (logout_subject IS NULL OR subject = logout_subject)
        AND (logout_provider_session_id IS NULL OR provider_session_id = logout_provider_session_id);
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;

CREATE FUNCTION app.auth_session_purge_expired() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.auth_sessions WHERE expires_at <= now();
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;

-- The user id for a verified identity-provider subject, or NULL.
CREATE FUNCTION app.lookup_user(subject text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$ SELECT u.id FROM app.users u WHERE u.auth_subject = subject $$;

REVOKE ALL ON FUNCTION
  app.auth_session_get(bytea),
  app.auth_session_put(bytea, text, text, bytea, timestamptz),
  app.auth_session_update(bytea, bytea, timestamptz),
  app.auth_session_delete(bytea),
  app.auth_session_delete_for_logout(text, text),
  app.auth_session_purge_expired(),
  app.lookup_user(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.auth_session_get(bytea),
  app.auth_session_put(bytea, text, text, bytea, timestamptz),
  app.auth_session_update(bytea, bytea, timestamptz),
  app.auth_session_delete(bytea),
  app.auth_session_delete_for_logout(text, text),
  app.auth_session_purge_expired(),
  app.lookup_user(text)
TO aisistent_runtime;

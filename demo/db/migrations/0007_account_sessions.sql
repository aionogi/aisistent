-- The signed-in user's own sign-in sessions on the account page. Both
-- functions resolve the user from the transaction context (withUser), never
-- from a subject the caller passes, and expose only times: no device,
-- browser, or location data is collected.

CREATE FUNCTION app.my_sessions()
  RETURNS TABLE (created_at timestamptz, updated_at timestamptz, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT s.created_at, s.updated_at, s.expires_at
    FROM app.auth_sessions s JOIN app.users u ON u.auth_subject = s.subject
    WHERE u.id = app.current_user_id() AND s.expires_at > now()
    ORDER BY s.updated_at DESC, s.created_at DESC
  $$;

-- Ends every application session of the signed-in user, on every device,
-- and records how many. Identity-provider sessions are not affected.
CREATE FUNCTION app.end_my_sessions() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    actor_subject text;
    removed integer;
  BEGIN
    SELECT auth_subject INTO actor_subject FROM app.users WHERE id = actor;
    IF actor_subject IS NULL THEN
      RAISE EXCEPTION 'user_required' USING ERRCODE = '42501';
    END IF;
    DELETE FROM app.auth_sessions WHERE subject = actor_subject;
    GET DIAGNOSTICS removed = ROW_COUNT;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (NULL, actor, 'auth.sessions_end', removed::text, 'success');
    RETURN removed;
  END
  $$;

REVOKE ALL ON FUNCTION app.my_sessions(), app.end_my_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_sessions(), app.end_my_sessions() TO aisistent_runtime;

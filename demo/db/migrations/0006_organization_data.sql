-- Organization data rights: owners export everything the organization holds
-- and can delete it permanently; any member can leave. Each function takes the
-- organization row lock first, the lock order of migration 0005, and checks
-- the caller's role after that lock.

-- The current organization's data as one JSON document, for owners. Leaves
-- out secrets and sign-in internals: invitation token hashes, sessions,
-- rate-limit buckets, and identity-provider subjects.
CREATE FUNCTION app.export_organization() RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    document jsonb;
  BEGIN
    SELECT jsonb_build_object(
      'organization', (SELECT jsonb_build_object('name', o.name, 'createdAt', o.created_at) FROM app.organizations o WHERE o.id = org),
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
      'activity', coalesce((
        SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'actor', coalesce(u.display_name, u.email), 'action', a.action, 'target', a.target, 'result', a.result) ORDER BY a.created_at, a.id)
        FROM app.audit_events a LEFT JOIN app.users u ON u.id = a.actor_user_id WHERE a.organization_id = org), '[]'::jsonb)
    ) INTO document;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, result)
      VALUES (org, app.current_user_id(), 'organization.export', 'success');
    RETURN document;
  END
  $$;

-- The caller leaves the current organization. The last owner cannot leave;
-- they first make someone else owner or delete the organization.
CREATE FUNCTION app.leave_organization() RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
    actor uuid := app.current_user_id();
    caller_role text;
    owners integer;
  BEGIN
    IF org IS NULL OR actor IS NULL OR app.member_role(org) IS NULL THEN
      RAISE EXCEPTION 'member_required' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM app.organizations WHERE id = org FOR NO KEY UPDATE;
    -- VOLATILE gives this query a fresh snapshot after any lock wait.
    caller_role := app.member_role(org);
    IF caller_role IS NULL THEN
      RAISE EXCEPTION 'member_required' USING ERRCODE = '42501';
    END IF;
    IF caller_role = 'owner' THEN
      SELECT count(*) INTO owners FROM app.memberships WHERE organization_id = org AND role = 'owner';
      IF owners <= 1 THEN
        RAISE EXCEPTION 'last_owner' USING ERRCODE = '23514';
      END IF;
    END IF;
    DELETE FROM app.memberships WHERE organization_id = org AND user_id = actor;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, actor, 'member.leave', actor::text, 'success');
  END
  $$;

-- Permanently deletes the current organization for every member. Memberships,
-- configuration, knowledge, and invitations go by cascade; its activity log is
-- deleted with it. One event without an organization keeps who deleted which
-- organization id and when. The caller repeats the organization's exact name.
CREATE FUNCTION app.delete_organization(confirm_name text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    organization_name text;
  BEGIN
    SELECT name INTO organization_name FROM app.organizations WHERE id = org;
    IF confirm_name IS NULL OR btrim(confirm_name) <> btrim(organization_name) THEN
      RAISE EXCEPTION 'confirmation_mismatch' USING ERRCODE = '22023';
    END IF;
    DELETE FROM app.audit_events WHERE organization_id = org;
    DELETE FROM app.organizations WHERE id = org;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (NULL, app.current_user_id(), 'organization.delete', org::text, 'success');
  END
  $$;

REVOKE ALL ON FUNCTION app.export_organization(), app.leave_organization(), app.delete_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.export_organization(), app.leave_organization(), app.delete_organization(text) TO aisistent_runtime;

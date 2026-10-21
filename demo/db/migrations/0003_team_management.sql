-- Team management: invitations, role changes, member removal, the member
-- list, and the audit log view.
--
-- Owners manage the team. Every operation runs through a SECURITY DEFINER
-- function that re-checks the caller's role in the current organization, so
-- the runtime role never writes memberships or invitations directly.
-- Invitation links carry a random token; only its SHA-256 hash is stored.

CREATE TABLE app.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations (id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320 AND position('@' IN email) > 1),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE INDEX invitations_org_idx ON app.invitations (organization_id, created_at DESC);
ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_read_owner ON app.invitations FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) = 'owner');
-- Token hashes are never readable by the application.
GRANT SELECT (id, organization_id, email, role, created_at, expires_at, accepted_at, revoked_at) ON app.invitations TO aisistent_runtime;

-- Raises unless the caller owns the current organization; returns its id.
CREATE FUNCTION app.require_owner() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
  BEGIN
    IF org IS NULL OR app.current_user_id() IS NULL OR app.member_role(org) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;
    RETURN org;
  END
  $$;

CREATE FUNCTION app.create_invitation(invite_email text, invite_role text, invite_token_hash bytea, invite_expires timestamptz) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    normalized text := lower(btrim(invite_email));
    created uuid;
  BEGIN
    IF invite_expires <= now() OR invite_expires > now() + interval '30 days' THEN
      RAISE EXCEPTION 'invalid_expiry' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app.memberships m JOIN app.users u ON u.id = m.user_id
      WHERE m.organization_id = org AND lower(u.email) = normalized
    ) THEN
      RAISE EXCEPTION 'already_member' USING ERRCODE = '23505';
    END IF;
    -- A new invitation replaces any open one for the same address.
    UPDATE app.invitations SET revoked_at = now()
      WHERE organization_id = org AND email = normalized AND accepted_at IS NULL AND revoked_at IS NULL;
    INSERT INTO app.invitations (organization_id, email, role, token_hash, created_by, expires_at)
      VALUES (org, normalized, invite_role, invite_token_hash, app.current_user_id(), invite_expires)
      RETURNING id INTO created;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'invitation.create', created::text, 'success');
    RETURN created;
  END
  $$;

CREATE FUNCTION app.revoke_invitation(invitation_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
  BEGIN
    UPDATE app.invitations SET revoked_at = now()
      WHERE id = invitation_id AND organization_id = org AND accepted_at IS NULL AND revoked_at IS NULL;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'invitation.revoke', invitation_id::text, 'success');
    RETURN true;
  END
  $$;

-- What a signed-in user may see before accepting: organization name, role,
-- invited address, and status. Unknown tokens return no row.
CREATE FUNCTION app.invitation_preview(invite_token_hash bytea)
  RETURNS TABLE (organization_name text, role text, email text, status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  BEGIN
    IF app.current_user_id() IS NULL THEN
      RAISE EXCEPTION 'user_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT o.name, i.role, i.email,
        CASE
          WHEN i.revoked_at IS NOT NULL THEN 'revoked'
          WHEN i.accepted_at IS NOT NULL THEN 'accepted'
          WHEN i.expires_at <= now() THEN 'expired'
          ELSE 'valid'
        END
      FROM app.invitations i JOIN app.organizations o ON o.id = i.organization_id
      WHERE i.token_hash = invite_token_hash;
  END
  $$;

-- Joins the invited organization. The signed-in user's verified email must
-- match the invitation, so a forwarded link is useless to anyone else.
CREATE FUNCTION app.accept_invitation(invite_token_hash bytea) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    invitation app.invitations%ROWTYPE;
    actor_email text;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'user_required' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO invitation FROM app.invitations WHERE token_hash = invite_token_hash FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF invitation.accepted_at IS NOT NULL THEN
      IF invitation.accepted_by = actor THEN
        RETURN invitation.organization_id;
      END IF;
      RAISE EXCEPTION 'invitation_used' USING ERRCODE = '22023';
    END IF;
    IF invitation.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invitation_revoked' USING ERRCODE = '22023';
    END IF;
    IF invitation.expires_at <= now() THEN
      RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '22023';
    END IF;
    SELECT email INTO actor_email FROM app.users WHERE id = actor;
    IF actor_email IS NULL OR lower(actor_email) <> invitation.email THEN
      RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.memberships (organization_id, user_id, role)
      VALUES (invitation.organization_id, actor, invitation.role)
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    UPDATE app.invitations SET accepted_at = now(), accepted_by = actor WHERE id = invitation.id;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (invitation.organization_id, actor, 'invitation.accept', invitation.id::text, 'success');
    RETURN invitation.organization_id;
  END
  $$;

-- Changes a member's role. The last owner cannot be demoted; locking the
-- owner rows serializes concurrent changes so two owners cannot demote each other.
CREATE FUNCTION app.change_member_role(target_user uuid, new_role text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    current_role_value text;
    owners integer;
  BEGIN
    IF new_role NOT IN ('owner', 'admin', 'member') THEN
      RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM app.memberships WHERE organization_id = org AND role = 'owner' FOR UPDATE;
    SELECT role INTO current_role_value FROM app.memberships WHERE organization_id = org AND user_id = target_user FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF current_role_value = new_role THEN
      RETURN;
    END IF;
    IF current_role_value = 'owner' THEN
      SELECT count(*) INTO owners FROM app.memberships WHERE organization_id = org AND role = 'owner';
      IF owners <= 1 THEN
        RAISE EXCEPTION 'last_owner' USING ERRCODE = '23514';
      END IF;
    END IF;
    UPDATE app.memberships SET role = new_role WHERE organization_id = org AND user_id = target_user;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'member.role_change', target_user::text || ' ' || current_role_value || '→' || new_role, 'success');
  END
  $$;

-- Removes a member. Access ends on their next request, because every
-- organization request re-checks membership; the last owner cannot be removed.
CREATE FUNCTION app.remove_member(target_user uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.require_owner();
    current_role_value text;
    owners integer;
  BEGIN
    PERFORM 1 FROM app.memberships WHERE organization_id = org AND role = 'owner' FOR UPDATE;
    SELECT role INTO current_role_value FROM app.memberships WHERE organization_id = org AND user_id = target_user FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF current_role_value = 'owner' THEN
      SELECT count(*) INTO owners FROM app.memberships WHERE organization_id = org AND role = 'owner';
      IF owners <= 1 THEN
        RAISE EXCEPTION 'last_owner' USING ERRCODE = '23514';
      END IF;
    END IF;
    DELETE FROM app.memberships WHERE organization_id = org AND user_id = target_user;
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (org, app.current_user_id(), 'member.remove', target_user::text, 'success');
  END
  $$;

-- The current organization's members with names and addresses, for any member.
CREATE FUNCTION app.list_members()
  RETURNS TABLE (user_id uuid, display_name text, email text, role text, joined_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
  BEGIN
    IF org IS NULL OR app.member_role(org) IS NULL THEN
      RAISE EXCEPTION 'member_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT u.id, u.display_name, u.email, m.role, m.created_at
      FROM app.memberships m JOIN app.users u ON u.id = m.user_id
      WHERE m.organization_id = org
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at;
  END
  $$;

-- Recent audit events with the actor's name, for owners and admins.
CREATE FUNCTION app.audit_log(max_rows integer)
  RETURNS TABLE (id bigint, created_at timestamptz, actor_name text, action text, target text, result text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
  BEGIN
    IF org IS NULL OR coalesce(app.member_role(org), '') NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT a.id, a.created_at, coalesce(u.display_name, u.email), a.action, a.target, a.result
      FROM app.audit_events a LEFT JOIN app.users u ON u.id = a.actor_user_id
      WHERE a.organization_id = org
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT least(greatest(max_rows, 1), 200);
  END
  $$;

REVOKE ALL ON FUNCTION
  app.require_owner(),
  app.create_invitation(text, text, bytea, timestamptz),
  app.revoke_invitation(uuid),
  app.invitation_preview(bytea),
  app.accept_invitation(bytea),
  app.change_member_role(uuid, text),
  app.remove_member(uuid),
  app.list_members(),
  app.audit_log(integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.require_owner(),
  app.create_invitation(text, text, bytea, timestamptz),
  app.revoke_invitation(uuid),
  app.invitation_preview(bytea),
  app.accept_invitation(bytea),
  app.change_member_role(uuid, text),
  app.remove_member(uuid),
  app.list_members(),
  app.audit_log(integer)
TO aisistent_runtime;

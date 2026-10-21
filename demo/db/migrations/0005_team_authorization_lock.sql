-- Serialize all membership/invitation mutations by organization, then check
-- authority against the state committed by the preceding operation. The owner
-- row locks in migration 0003 protected the last owner but did not refresh the
-- caller's authority after waiting for another owner to demote/remove them.
CREATE OR REPLACE FUNCTION app.require_owner() RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    org uuid := app.current_organization_id();
  BEGIN
    IF org IS NULL OR app.current_user_id() IS NULL OR app.member_role(org) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM app.organizations WHERE id = org FOR NO KEY UPDATE;
    -- VOLATILE gives this query a fresh snapshot after any lock wait.
    IF NOT FOUND OR app.member_role(org) IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;
    RETURN org;
  END
  $$;

-- Accepting takes the same organization lock before locking the invitation.
-- Keeping one lock order avoids deadlocks with replacement and revocation,
-- and prevents a replacement from creating another link for a new member.
CREATE OR REPLACE FUNCTION app.accept_invitation(invite_token_hash bytea) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    invitation_organization uuid;
    invitation app.invitations%ROWTYPE;
    actor_email text;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'user_required' USING ERRCODE = '42501';
    END IF;
    SELECT organization_id INTO invitation_organization FROM app.invitations WHERE token_hash = invite_token_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM app.organizations WHERE id = invitation_organization FOR NO KEY UPDATE;
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

-- If an older release created duplicates concurrently, retain its newest link
-- and revoke the older links, matching the replacement behavior of the UI.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id, email ORDER BY created_at DESC, id DESC) AS position
  FROM app.invitations WHERE accepted_at IS NULL AND revoked_at IS NULL
), revoked AS (
  UPDATE app.invitations AS invitation SET revoked_at = now()
  FROM ranked WHERE invitation.id = ranked.id AND ranked.position > 1
  RETURNING invitation.organization_id, invitation.id
)
INSERT INTO app.audit_events (organization_id, action, target, result)
  SELECT organization_id, 'invitation.revoke', id::text, 'success' FROM revoked;

CREATE UNIQUE INDEX invitations_one_pending_per_address
  ON app.invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

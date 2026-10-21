-- Core tenancy: users, organizations, memberships, assistant configuration,
-- knowledge entries, and audit events, protected by row-level security.
--
-- Roles
--   * The migration owner (Render's default database user) owns every object.
--     As table owner it bypasses RLS; only migrations and the SECURITY DEFINER
--     functions below run with its rights.
--   * aisistent_runtime (NOLOGIN) carries the application's privileges. The
--     application logs in as aisistent_app, a member of this role created by
--     the migration runner, so it can never RESET ROLE to the owner.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aisistent_runtime') THEN
    CREATE ROLE aisistent_runtime NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO aisistent_runtime;

-- Request context. Set per transaction by the server after it has verified
-- the session; empty or missing values mean "no user" / "no organization".
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE CHECK (length(auth_subject) BETWEEN 1 AND 255),
  email text CHECK (email IS NULL OR length(email) <= 320),
  display_name text CHECK (display_name IS NULL OR length(display_name) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  organization_id uuid NOT NULL REFERENCES app.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON app.memberships (user_id);

-- One configuration document per organization, shaped like the M2
-- WorkspaceDraft and validated by the application before writing.
CREATE TABLE app.assistant_configs (
  organization_id uuid PRIMARY KEY REFERENCES app.organizations (id) ON DELETE CASCADE,
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users (id) ON DELETE SET NULL
);

CREATE TABLE app.knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations (id) ON DELETE CASCADE,
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 120),
  answer text NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 400),
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_entries_org_idx ON app.knowledge_entries (organization_id);

-- Append-only record of sensitive actions. No secrets or message content.
CREATE TABLE app.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES app.organizations (id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target text CHECK (target IS NULL OR length(target) <= 200),
  result text NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_idx ON app.audit_events (organization_id, created_at DESC);

-- The caller's role in an organization, read with the owner's rights so that
-- policies on memberships can use it without recursing into themselves.
CREATE FUNCTION app.member_role(target_organization uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    SELECT m.role
    FROM app.memberships m
    WHERE m.organization_id = target_organization
      AND m.user_id = app.current_user_id()
  $$;

-- Creates or refreshes the user record for a subject the server has already
-- verified with the identity provider.
CREATE FUNCTION app.provision_user(subject text, user_email text, user_display_name text) RETURNS uuid
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
    INSERT INTO app.users AS u (auth_subject, email, display_name, last_seen_at)
    VALUES (subject, user_email, user_display_name, now())
    ON CONFLICT (auth_subject) DO UPDATE
      SET email = excluded.email,
          display_name = coalesce(excluded.display_name, u.display_name),
          last_seen_at = now()
    RETURNING u.id
  $$;

-- Creates an organization with the current user as its owner.
CREATE FUNCTION app.create_organization(organization_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = app, pg_temp
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    created uuid;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'create_organization requires an authenticated user' USING ERRCODE = '42501';
    END IF;
    INSERT INTO app.organizations (name) VALUES (btrim(organization_name)) RETURNING id INTO created;
    INSERT INTO app.memberships (organization_id, user_id, role) VALUES (created, actor, 'owner');
    INSERT INTO app.audit_events (organization_id, actor_user_id, action, target, result)
      VALUES (created, actor, 'organization.create', created::text, 'success');
    RETURN created;
  END
  $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.current_user_id(),
  app.current_organization_id(),
  app.member_role(uuid),
  app.provision_user(text, text, text),
  app.create_organization(text)
TO aisistent_runtime;

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;

-- Users see and edit only themselves. New rows come from provision_user().
CREATE POLICY users_read_self ON app.users FOR SELECT TO aisistent_runtime
  USING (id = app.current_user_id());
CREATE POLICY users_update_self ON app.users FOR UPDATE TO aisistent_runtime
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());

-- Organizations the user belongs to. New rows come from create_organization().
CREATE POLICY organizations_read_member ON app.organizations FOR SELECT TO aisistent_runtime
  USING (app.member_role(id) IS NOT NULL);
CREATE POLICY organizations_update_admin ON app.organizations FOR UPDATE TO aisistent_runtime
  USING (app.member_role(id) IN ('owner', 'admin'))
  WITH CHECK (app.member_role(id) IN ('owner', 'admin'));

-- Own memberships, plus the member list of organizations the user belongs to.
CREATE POLICY memberships_read ON app.memberships FOR SELECT TO aisistent_runtime
  USING (user_id = app.current_user_id() OR app.member_role(organization_id) IS NOT NULL);

-- Tenant data is visible only inside the selected organization, to its members.
CREATE POLICY assistant_configs_read ON app.assistant_configs FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IS NOT NULL);
CREATE POLICY assistant_configs_insert ON app.assistant_configs FOR INSERT TO aisistent_runtime
  WITH CHECK (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY assistant_configs_update ON app.assistant_configs FOR UPDATE TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY knowledge_read ON app.knowledge_entries FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IS NOT NULL);
CREATE POLICY knowledge_insert ON app.knowledge_entries FOR INSERT TO aisistent_runtime
  WITH CHECK (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY knowledge_update ON app.knowledge_entries FOR UPDATE TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY knowledge_delete ON app.knowledge_entries FOR DELETE TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));

-- Anyone may record their own actions; only owners and admins read the log.
CREATE POLICY audit_insert_self ON app.audit_events FOR INSERT TO aisistent_runtime
  WITH CHECK (
    actor_user_id = app.current_user_id()
    AND (organization_id IS NULL OR app.member_role(organization_id) IS NOT NULL)
  );
CREATE POLICY audit_read_admin ON app.audit_events FOR SELECT TO aisistent_runtime
  USING (organization_id = app.current_organization_id() AND app.member_role(organization_id) IN ('owner', 'admin'));

GRANT SELECT, UPDATE (display_name, last_seen_at) ON app.users TO aisistent_runtime;
GRANT SELECT, UPDATE (name) ON app.organizations TO aisistent_runtime;
GRANT SELECT ON app.memberships TO aisistent_runtime;
GRANT SELECT, INSERT, UPDATE (config, revision, updated_at, updated_by) ON app.assistant_configs TO aisistent_runtime;
GRANT SELECT, INSERT, UPDATE (question, answer, updated_at), DELETE ON app.knowledge_entries TO aisistent_runtime;
GRANT SELECT, INSERT (organization_id, actor_user_id, action, target, result) ON app.audit_events TO aisistent_runtime;

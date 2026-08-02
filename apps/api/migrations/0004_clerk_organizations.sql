ALTER TABLE users
  ADD COLUMN clerk_updated_at bigint NOT NULL DEFAULT 0;

ALTER TABLE organizations
  ADD COLUMN clerk_updated_at bigint NOT NULL DEFAULT 0;

ALTER TABLE memberships
  ADD COLUMN clerk_updated_at bigint NOT NULL DEFAULT 0;

CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  clerk_invitation_id text NOT NULL UNIQUE,
  email_address text NOT NULL,
  role organization_role NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'revoked')),
  clerk_updated_at bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_invitations
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;

CREATE INDEX active_memberships_by_org
  ON memberships(organization_id) WHERE state = 'active';
CREATE INDEX pending_invitations_by_org
  ON organization_invitations(organization_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS admin_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_normalized_email_key UNIQUE (normalized_email),
  CONSTRAINT admin_users_role_valid CHECK (role IN ('admin', 'viewer')),
  CONSTRAINT admin_users_email_nonempty CHECK (length(trim(email)) > 0),
  CONSTRAINT admin_users_password_hash_nonempty CHECK (length(trim(password_hash)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_users_role_idx ON admin_users (role);
CREATE INDEX IF NOT EXISTS admin_users_disabled_at_idx ON admin_users (disabled_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES admin_users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  session_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  user_agent_hash text,
  ip_hash text,
  CONSTRAINT admin_sessions_token_hash_key UNIQUE (session_token_hash),
  CONSTRAINT admin_sessions_token_hash_nonempty CHECK (length(trim(session_token_hash)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_sessions_user_id_idx ON admin_sessions (user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions (expires_at);
CREATE INDEX IF NOT EXISTS admin_sessions_active_token_idx
  ON admin_sessions (session_token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id bigint REFERENCES admin_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  event_type text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_events_event_type_nonempty CHECK (length(trim(event_type)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_audit_events_created_id_idx ON admin_audit_events (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_user_id_idx ON admin_audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx ON admin_audit_events (target_type, target_id);

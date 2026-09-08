-- Run in Supabase SQL Editor if `pnpm run setup:db` cannot connect.
-- Safe on a new empty project.

-- The billing tenant: one Clerk-backed organization owns the subscription,
-- the credit balance, and any number of venues.
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  clerk_org_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  credits_balance INTEGER NOT NULL DEFAULT 5,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tagline TEXT,
  description TEXT,
  owner_email TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  website_url TEXT,
  booking_url TEXT,
  plan TEXT NOT NULL DEFAULT 'trial',
  credits_balance INTEGER NOT NULL DEFAULT 5,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE venues
  ALTER COLUMN owner_email SET NOT NULL;

CREATE TABLE IF NOT EXISTS owner_login_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_email TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owner_credentials (
  id SERIAL PRIMARY KEY,
  owner_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  id SERIAL PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  owner_email TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venue_media (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  coverage TEXT NOT NULL DEFAULT 'detail',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE venue_media
  ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT 'detail';

CREATE UNIQUE INDEX IF NOT EXISTS venue_media_venue_object_key_unique
  ON venue_media (venue_id, object_key);

CREATE TABLE IF NOT EXISTS upload_intents (
  id SERIAL PRIMARY KEY,
  object_key TEXT NOT NULL,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS upload_intents_object_key_unique
  ON upload_intents (object_key);

CREATE TABLE IF NOT EXISTS couple_sessions (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  style_id TEXT,
  couple_name TEXT,
  couple_email TEXT NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

ALTER TABLE couple_sessions
  ALTER COLUMN couple_email SET NOT NULL,
  ALTER COLUMN share_token SET NOT NULL;

CREATE TABLE IF NOT EXISTS couple_media (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES couple_sessions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_assets (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES couple_sessions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'image',
  display_order INTEGER NOT NULL DEFAULT 0,
  generation_model TEXT,
  generation_attempts INTEGER,
  venue_reference_indexes JSONB,
  quality_report JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE generated_assets
  ADD COLUMN IF NOT EXISTS generation_model TEXT,
  ADD COLUMN IF NOT EXISTS generation_attempts INTEGER,
  ADD COLUMN IF NOT EXISTS venue_reference_indexes JSONB,
  ADD COLUMN IF NOT EXISTS quality_report JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS generated_assets_object_key_unique
  ON generated_assets (object_key);

CREATE UNIQUE INDEX IF NOT EXISTS generated_assets_session_slot_unique
  ON generated_assets (session_id, asset_type, display_order);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  venue_id INTEGER REFERENCES venues(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  session_id INTEGER REFERENCES couple_sessions(id) ON DELETE SET NULL,
  stripe_event_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ledger rows moved to the organization level; venue_id is provenance only.
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id),
  ALTER COLUMN venue_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_stripe_event_id_unique
  ON credit_transactions (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- ————————————————————————————————————————————————————————————————————————
-- Autonomous business control plane
--
-- The agent fleet, its decision ledger, the guardrails it runs under, and the
-- domain surfaces it operates on. Every table is organization-scoped; the app
-- degrades to a read-only "not migrated" notice when they are absent, so this
-- block is safe to apply after the fact.
-- ————————————————————————————————————————————————————————————————————————

CREATE TABLE IF NOT EXISTS control_plane_agents (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  autonomy TEXT NOT NULL DEFAULT 'recommend',
  status TEXT NOT NULL DEFAULT 'idle',
  health_score DOUBLE PRECISION NOT NULL DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  daily_action_budget INTEGER NOT NULL DEFAULT 25,
  actions_today INTEGER NOT NULL DEFAULT 0,
  budget_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  last_error TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_agents_org_agent_unique
  ON control_plane_agents (organization_id, agent_key);
CREATE INDEX IF NOT EXISTS control_plane_agents_due_idx
  ON control_plane_agents (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS control_plane_signals (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'product',
  subject_type TEXT,
  subject_id TEXT,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_signals_org_occurred_idx
  ON control_plane_signals (organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS control_plane_signals_kind_idx
  ON control_plane_signals (kind);

CREATE TABLE IF NOT EXISTS control_plane_runs (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  duration_ms INTEGER,
  observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_count INTEGER NOT NULL DEFAULT 0,
  executed_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  narrative TEXT,
  error TEXT,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS control_plane_runs_org_started_idx
  ON control_plane_runs (organization_id, started_at);

CREATE TABLE IF NOT EXISTS control_plane_decisions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES control_plane_runs(id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  effect JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  impact_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'proposed',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  blocked_reason TEXT,
  decided_by TEXT,
  decided_at TIMESTAMP,
  decision_note TEXT,
  executed_at TIMESTAMP,
  execution_result JSONB,
  expires_at TIMESTAMP,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_decisions_org_dedupe_unique
  ON control_plane_decisions (organization_id, dedupe_key);
CREATE INDEX IF NOT EXISTS control_plane_decisions_org_status_idx
  ON control_plane_decisions (organization_id, status);

CREATE TABLE IF NOT EXISTS control_plane_policies (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_policies_org_key_unique
  ON control_plane_policies (organization_id, key);

CREATE TABLE IF NOT EXISTS control_plane_audit (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_audit_org_created_idx
  ON control_plane_audit (organization_id, created_at);

CREATE TABLE IF NOT EXISTS control_plane_experiments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  surface TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  variants JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  minimum_sample_size INTEGER NOT NULL DEFAULT 200,
  started_at TIMESTAMP,
  concluded_at TIMESTAMP,
  result JSONB,
  created_by TEXT NOT NULL DEFAULT 'experiments-agent',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_experiments_org_key_unique
  ON control_plane_experiments (organization_id, key);

CREATE TABLE IF NOT EXISTS control_plane_experiment_assignments (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES control_plane_experiments(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_experiment_subject_unique
  ON control_plane_experiment_assignments (experiment_id, subject_key);

CREATE TABLE IF NOT EXISTS control_plane_experiment_events (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES control_plane_experiments(id) ON DELETE CASCADE,
  subject_key TEXT NOT NULL,
  variant TEXT NOT NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL DEFAULT 1,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_experiment_events_metric_idx
  ON control_plane_experiment_events (experiment_id, metric);

CREATE TABLE IF NOT EXISTS control_plane_tickets (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  session_id INTEGER REFERENCES couple_sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'web',
  requester_email TEXT,
  requester_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  ai_draft TEXT,
  resolution_note TEXT,
  first_response_at TIMESTAMP,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_tickets_org_status_idx
  ON control_plane_tickets (organization_id, status);

CREATE TABLE IF NOT EXISTS control_plane_leads (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  source TEXT NOT NULL DEFAULT 'inbound',
  stage TEXT NOT NULL DEFAULT 'new',
  score INTEGER NOT NULL DEFAULT 0,
  owner_agent TEXT NOT NULL DEFAULT 'sales-agent',
  notes TEXT,
  next_action_at TIMESTAMP,
  last_touch_at TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_leads_org_stage_idx
  ON control_plane_leads (organization_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS control_plane_leads_org_email_unique
  ON control_plane_leads (organization_id, contact_email);

CREATE TABLE IF NOT EXISTS control_plane_work_items (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'repair',
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  surface TEXT NOT NULL DEFAULT 'platform',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_id INTEGER REFERENCES control_plane_decisions(id) ON DELETE SET NULL,
  dedupe_key TEXT NOT NULL,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_work_items_org_dedupe_unique
  ON control_plane_work_items (organization_id, dedupe_key);
CREATE INDEX IF NOT EXISTS control_plane_work_items_org_status_idx
  ON control_plane_work_items (organization_id, status);

CREATE TABLE IF NOT EXISTS control_plane_metrics (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  metric_key TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_metrics_org_date_key_unique
  ON control_plane_metrics (organization_id, metric_date, metric_key);

CREATE TABLE IF NOT EXISTS control_plane_memory (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'insight',
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  superseded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_plane_memory_org_agent_idx
  ON control_plane_memory (organization_id, agent_key);

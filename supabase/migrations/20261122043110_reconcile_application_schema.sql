-- Add the currently missing application schema without deleting or rewriting rows.
-- Derived from reviewed bootstrap.sql / Drizzle definitions on 2026-11-21.
-- All new tables retain the server-only access contract. Existing legacy auth
-- tables are deliberately untouched. No balances, consent or delivery states are backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = public;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trial_expired_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS first_paid_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS churned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS low_credit_notified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trial_granted_by_clerk_user_id TEXT,
  ADD COLUMN IF NOT EXISTS attribution_prospect_id INTEGER,
  ADD COLUMN IF NOT EXISTS attribution_campaign_id INTEGER,
  ADD COLUMN IF NOT EXISTS share_aggregates BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS incentive_text TEXT,
  ADD COLUMN IF NOT EXISTS tour_card_downloaded_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS website_imported_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS review_before_send BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE venue_media
  ADD COLUMN IF NOT EXISTS perceptual_hash TEXT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS content_type TEXT;

ALTER TABLE venue_media
  ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT 'detail';

ALTER TABLE couple_sessions
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS failure_detail TEXT,
  ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cta_clicks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'couple',
  ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'couple_link',
  ADD COLUMN IF NOT EXISTS wedding_month TEXT,
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS booked_by TEXT,
  ADD COLUMN IF NOT EXISTS source_photos_deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS delivery_hold_reason TEXT;

ALTER TABLE control_experiments
  ADD COLUMN IF NOT EXISTS primary_metric_key TEXT,
  ADD COLUMN IF NOT EXISTS baseline DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS min_detectable_lift DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS kill_threshold DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS decision_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS segment TEXT,
  ADD COLUMN IF NOT EXISTS variant_key TEXT,
  ADD COLUMN IF NOT EXISTS assignments JSONB,
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS observed_value DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS observed_n INTEGER,
  ADD COLUMN IF NOT EXISTS evaluation JSONB;

ALTER TABLE control_prospects
  ADD COLUMN IF NOT EXISTS vetting_status TEXT NOT NULL DEFAULT 'unvetted',
  ADD COLUMN IF NOT EXISTS legitimacy_score INTEGER,
  ADD COLUMN IF NOT EXISTS vetted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS venue_type TEXT,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reply_sentiment TEXT,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS converted_organization_id INTEGER,
  ADD COLUMN IF NOT EXISTS converted_campaign_id INTEGER,
  ADD COLUMN IF NOT EXISTS attribution_method TEXT;

ALTER TABLE control_outreach_emails
  ADD COLUMN IF NOT EXISTS variant_key TEXT,
  ADD COLUMN IF NOT EXISTS cited_facts JSONB,
  ADD COLUMN IF NOT EXISTS vetting_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS gallery_events (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES couple_sessions(id) ON DELETE CASCADE,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT,
  ip_hash TEXT,
  meta JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS render_attempts (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES couple_sessions(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  model TEXT NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  size TEXT,
  quality TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  judge_report JSONB,
  outcome TEXT NOT NULL,
  error_class TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  payload JSONB
);

CREATE TABLE IF NOT EXISTS billing_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  plan TEXT,
  face_value_credits INTEGER,
  amount_cents INTEGER,
  stripe_event_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funnel_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  venue_id INTEGER,
  event TEXT NOT NULL,
  properties JSONB,
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_prospect_vetting (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES control_prospects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'A',
  hard_fails JSONB NOT NULL,
  checks JSONB NOT NULL,
  summary TEXT NOT NULL,
  contact_domain TEXT NOT NULL,
  mx_provider TEXT,
  domain_registered_at TIMESTAMP,
  first_capture_at TIMESTAMP,
  places_place_id TEXT,
  vetted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  vetted_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_prospect_facts (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES control_prospects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'verified',
  verified_at TIMESTAMP,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_copy_variants (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  angle TEXT NOT NULL,
  default_ask TEXT NOT NULL DEFAULT 'preview',
  is_control BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  weight DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  paused_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_adaptations (
  id SERIAL PRIMARY KEY,
  rule_key TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  action TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  reason TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES control_metrics_snapshots(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_digests (
  id SERIAL PRIMARY KEY,
  week_start TIMESTAMP NOT NULL,
  document JSONB NOT NULL,
  html TEXT NOT NULL,
  "text" TEXT NOT NULL,
  polished_by TEXT,
  action_id INTEGER REFERENCES agent_actions(id) ON DELETE SET NULL,
  sent_to JSONB,
  sent_at TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT 'system:scheduler',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_trial_grantee_unique
  ON organizations (trial_granted_by_clerk_user_id)
  WHERE trial_granted_by_clerk_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS venue_media_venue_object_key_unique
  ON venue_media (venue_id, object_key);

CREATE UNIQUE INDEX IF NOT EXISTS upload_intents_object_key_unique
  ON upload_intents (object_key);

CREATE UNIQUE INDEX IF NOT EXISTS generated_assets_object_key_unique
  ON generated_assets (object_key);

CREATE UNIQUE INDEX IF NOT EXISTS generated_assets_session_slot_unique
  ON generated_assets (session_id, asset_type, display_order);

CREATE INDEX IF NOT EXISTS gallery_events_session_idx
  ON gallery_events (session_id, created_at);

CREATE INDEX IF NOT EXISTS gallery_events_venue_type_idx
  ON gallery_events (venue_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS render_attempts_session_idx
  ON render_attempts (session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_stripe_event_id_unique
  ON credit_transactions (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_events_org_idx
  ON billing_events (organization_id, created_at);

CREATE INDEX IF NOT EXISTS agent_runs_agent_key_idx
  ON agent_runs (agent_key, started_at);

CREATE INDEX IF NOT EXISTS agent_tasks_status_idx
  ON agent_tasks (status, created_at);

CREATE INDEX IF NOT EXISTS agent_actions_status_idx
  ON agent_actions (status, created_at);

CREATE INDEX IF NOT EXISTS control_audit_events_created_idx
  ON control_audit_events (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_prospects_email_unique
  ON control_prospects (email);

CREATE INDEX IF NOT EXISTS control_prospects_status_idx
  ON control_prospects (status, updated_at);

CREATE INDEX IF NOT EXISTS control_prospects_campaign_idx
  ON control_prospects (campaign_id);

CREATE INDEX IF NOT EXISTS control_prospects_vetting_idx
  ON control_prospects (vetting_status, score);

CREATE INDEX IF NOT EXISTS control_prospects_converted_org_idx
  ON control_prospects (converted_organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS control_policies_key_unique
  ON control_policies (key);

CREATE INDEX IF NOT EXISTS funnel_events_event_idx
  ON funnel_events (event, created_at);

CREATE INDEX IF NOT EXISTS funnel_events_org_idx
  ON funnel_events (organization_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_research_prospect_unique
  ON control_prospect_research (prospect_id);

CREATE INDEX IF NOT EXISTS control_prospect_assets_prospect_idx
  ON control_prospect_assets (prospect_id, score);

CREATE INDEX IF NOT EXISTS control_outreach_emails_prospect_idx
  ON control_outreach_emails (prospect_id, created_at);

CREATE INDEX IF NOT EXISTS control_outreach_emails_status_idx
  ON control_outreach_emails (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_outreach_emails_token_unique
  ON control_outreach_emails (unsubscribe_token);

CREATE UNIQUE INDEX IF NOT EXISTS control_outreach_emails_claim_token_unique
  ON control_outreach_emails (claim_token)
  WHERE claim_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS control_outreach_emails_provider_idx
  ON control_outreach_emails (provider_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS control_email_suppressions_email_unique
  ON control_email_suppressions (email);

CREATE INDEX IF NOT EXISTS control_email_events_email_idx
  ON control_email_events (email_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_email_events_provider_event_unique
  ON control_email_events (provider_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_vetting_prospect_unique
  ON control_prospect_vetting (prospect_id);

CREATE INDEX IF NOT EXISTS control_prospect_vetting_status_idx
  ON control_prospect_vetting (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_facts_unique
  ON control_prospect_facts (prospect_id, kind, value);

CREATE INDEX IF NOT EXISTS control_prospect_facts_prospect_idx
  ON control_prospect_facts (prospect_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS control_copy_variants_key_unique
  ON control_copy_variants (key);

CREATE INDEX IF NOT EXISTS control_adaptations_created_idx
  ON control_adaptations (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_digests_week_unique
  ON control_digests (week_start);

ALTER TABLE public.gallery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_adaptations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_copy_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_prospect_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_prospect_vetting ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
COMMIT;

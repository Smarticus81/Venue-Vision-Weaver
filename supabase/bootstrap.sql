-- Run in Supabase SQL Editor if `pnpm run setup:db` cannot connect.
-- Safe on a new empty project and idempotent on an existing one (CREATE TABLE /
-- CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
--
-- Generated from the Drizzle schema in lib/db/src/schema (drizzle-kit generate,
-- 2026-10-08) and reformatted; `pnpm --filter @workspace/db run push` applies
-- the same shape. Regenerate this file whenever lib/db/src/schema changes.
--
-- Row Level Security is enabled on every table and the PostgREST roles lose
-- all table grants at the end of this file: the API server connects as the
-- table owner, so RLS does not affect it, and nothing should reach these
-- tables through the Supabase anon/authenticated keys.

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
  subscription_status TEXT,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  contact_email TEXT,
  trial_ends_at TIMESTAMP,
  trial_expired_at TIMESTAMP,
  first_paid_at TIMESTAMP,
  churned_at TIMESTAMP,
  low_credit_notified_at TIMESTAMP,
  trial_granted_by_clerk_user_id TEXT,
  attribution_prospect_id INTEGER,
  attribution_campaign_id INTEGER,
  share_aggregates BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tagline TEXT,
  description TEXT,
  owner_email TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  website_url TEXT,
  booking_url TEXT,
  incentive_text TEXT,
  tour_card_downloaded_at TIMESTAMP,
  website_imported_at TIMESTAMP,
  review_before_send BOOLEAN NOT NULL DEFAULT FALSE,
  plan TEXT NOT NULL DEFAULT 'trial',
  credits_balance INTEGER NOT NULL DEFAULT 5,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS incentive_text TEXT,
  ADD COLUMN IF NOT EXISTS tour_card_downloaded_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS website_imported_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS review_before_send BOOLEAN NOT NULL DEFAULT FALSE;

-- Upgrade path for databases created before these columns existed.
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

ALTER TABLE venues
  ALTER COLUMN owner_email SET NOT NULL;

CREATE TABLE IF NOT EXISTS venue_media (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  coverage TEXT NOT NULL DEFAULT 'detail',
  display_order INTEGER NOT NULL DEFAULT 0,
  perceptual_hash TEXT,
  width INTEGER,
  height INTEGER,
  content_type TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE venue_media
  ADD COLUMN IF NOT EXISTS perceptual_hash TEXT,
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS content_type TEXT;

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
  started_at TIMESTAMP,
  failure_detail TEXT,
  first_viewed_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'couple',
  created_via TEXT NOT NULL DEFAULT 'couple_link',
  wedding_month TEXT,
  consent_at TIMESTAMP,
  booked_at TIMESTAMP,
  booked_by TEXT,
  source_photos_deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

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
  ADD COLUMN IF NOT EXISTS source_photos_deleted_at TIMESTAMP;

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

-- Gallery funnel log and per-attempt render telemetry

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

CREATE INDEX IF NOT EXISTS gallery_events_session_idx
  ON gallery_events (session_id, created_at);

CREATE INDEX IF NOT EXISTS gallery_events_venue_type_idx
  ON gallery_events (venue_id, event_type, created_at);

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

CREATE INDEX IF NOT EXISTS render_attempts_session_idx
  ON render_attempts (session_id, created_at);

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

-- Billing event logs (Stripe webhook idempotency + business billing history)

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

CREATE INDEX IF NOT EXISTS billing_events_org_idx
  ON billing_events (organization_id, created_at);

-- ————— Autonomous Business Control Plane —————
-- A multi-agent operating system (prospecting, outreach, campaigns, support,
-- product, finance, experiments, activation, governance) runs the business;
-- these tables persist agent scheduling state, runs, tasks, governed actions,
-- the prospect pipeline, outreach campaigns, experiments, KPI snapshots, the
-- audit trail, and governance policies.

CREATE TABLE IF NOT EXISTS control_agents (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  interval_minutes INTEGER NOT NULL DEFAULT 360,
  last_run_at TIMESTAMP,
  last_run_status TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  agent_key TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT,
  summary TEXT,
  error TEXT,
  transcript JSONB,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_key_idx
  ON agent_runs (agent_key, started_at);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id SERIAL PRIMARY KEY,
  agent_key TEXT NOT NULL,
  run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  detail TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_tasks_status_idx
  ON agent_tasks (status, created_at);

CREATE TABLE IF NOT EXISTS agent_actions (
  id SERIAL PRIMARY KEY,
  agent_key TEXT NOT NULL,
  run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reasoning TEXT,
  params JSONB NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decision_note TEXT,
  decided_at TIMESTAMP,
  executed_at TIMESTAMP,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_actions_status_idx
  ON agent_actions (status, created_at);

CREATE TABLE IF NOT EXISTS control_experiments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  metric TEXT NOT NULL,
  variants JSONB,
  status TEXT NOT NULL DEFAULT 'proposed',
  result TEXT,
  created_by_agent TEXT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  primary_metric_key TEXT,
  baseline DOUBLE PRECISION,
  min_detectable_lift DOUBLE PRECISION,
  kill_threshold DOUBLE PRECISION,
  decision_date TIMESTAMP,
  segment TEXT,
  variant_key TEXT,
  assignments JSONB,
  decision TEXT,
  decided_by TEXT,
  decided_at TIMESTAMP,
  observed_value DOUBLE PRECISION,
  observed_n INTEGER,
  evaluation JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS control_metrics_snapshots (
  id SERIAL PRIMARY KEY,
  metrics JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_audit_events (
  id SERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  detail JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_audit_events_created_idx
  ON control_audit_events (created_at);

CREATE TABLE IF NOT EXISTS control_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  audience TEXT,
  steps JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_agent TEXT,
  launched_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_prospects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  region TEXT,
  source TEXT NOT NULL DEFAULT 'agent_research',
  score INTEGER NOT NULL DEFAULT 0,
  qualification TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  campaign_id INTEGER REFERENCES control_campaigns(id) ON DELETE SET NULL,
  campaign_step INTEGER NOT NULL DEFAULT 0,
  contact_count INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TIMESTAMP,
  status_changed_by TEXT,
  vetting_status TEXT NOT NULL DEFAULT 'unvetted',
  legitimacy_score INTEGER,
  vetted_at TIMESTAMP,
  venue_type TEXT,
  replied_at TIMESTAMP,
  reply_sentiment TEXT,
  converted_at TIMESTAMP,
  converted_organization_id INTEGER,
  converted_campaign_id INTEGER,
  attribution_method TEXT,
  created_by_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS control_policies (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_policies_key_unique
  ON control_policies (key);

-- Product funnel log (landing -> signup -> venue ready -> first gallery -> paid)

CREATE TABLE IF NOT EXISTS funnel_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER,
  venue_id INTEGER,
  event TEXT NOT NULL,
  properties JSONB,
  source TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS funnel_events_event_idx
  ON funnel_events (event, created_at);

CREATE INDEX IF NOT EXISTS funnel_events_org_idx
  ON funnel_events (organization_id, created_at);

-- Outreach email studio (venue research, images, studio emails, suppression, delivery events)

CREATE TABLE IF NOT EXISTS control_prospect_research (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES control_prospects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ok',
  source_urls JSONB NOT NULL,
  facts JSONB NOT NULL,
  warnings JSONB NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_research_prospect_unique
  ON control_prospect_research (prospect_id);

CREATE TABLE IF NOT EXISTS control_prospect_assets (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES control_prospects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'venue_image',
  object_key TEXT NOT NULL,
  source_url TEXT,
  page_url TEXT,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  alt_text TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL DEFAULT 'research',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_prospect_assets_prospect_idx
  ON control_prospect_assets (prospect_id, score);

CREATE TABLE IF NOT EXISTS control_outreach_emails (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES control_prospects(id) ON DELETE CASCADE,
  action_id INTEGER REFERENCES agent_actions(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES control_campaigns(id) ON DELETE SET NULL,
  step INTEGER,
  variant_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  subject_options JSONB NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  greeting TEXT NOT NULL,
  sign_off TEXT NOT NULL,
  cta_label TEXT NOT NULL,
  cta_url TEXT NOT NULL,
  image_asset_ids JSONB NOT NULL,
  draft_notes JSONB,
  cited_facts JSONB,
  vetting_snapshot JSONB,
  unsubscribe_token TEXT NOT NULL,
  claim_token TEXT,
  html_snapshot TEXT,
  text_snapshot TEXT,
  provider_message_id TEXT,
  sent_to TEXT,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  bounced_at TIMESTAMP,
  bounce_reason TEXT,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  last_error TEXT,
  created_by_agent TEXT,
  edited_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE control_outreach_emails
  ADD COLUMN IF NOT EXISTS variant_key TEXT,
  ADD COLUMN IF NOT EXISTS cited_facts JSONB,
  ADD COLUMN IF NOT EXISTS vetting_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP;

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

CREATE TABLE IF NOT EXISTS control_email_suppressions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  prospect_id INTEGER REFERENCES control_prospects(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS control_email_suppressions_email_unique
  ON control_email_suppressions (email);

CREATE TABLE IF NOT EXISTS control_email_events (
  id SERIAL PRIMARY KEY,
  email_id INTEGER REFERENCES control_outreach_emails(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS control_email_events_email_idx
  ON control_email_events (email_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS control_email_events_provider_event_unique
  ON control_email_events (provider_event_id);

-- Prospect vetting (legitimacy verdicts and cited facts)

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

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_vetting_prospect_unique
  ON control_prospect_vetting (prospect_id);

CREATE INDEX IF NOT EXISTS control_prospect_vetting_status_idx
  ON control_prospect_vetting (status, expires_at);

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

CREATE UNIQUE INDEX IF NOT EXISTS control_prospect_facts_unique
  ON control_prospect_facts (prospect_id, kind, value);

CREATE INDEX IF NOT EXISTS control_prospect_facts_prospect_idx
  ON control_prospect_facts (prospect_id, status);

-- Growth loop (copy variants, adaptation log, weekly digests)

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

CREATE UNIQUE INDEX IF NOT EXISTS control_copy_variants_key_unique
  ON control_copy_variants (key);

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

CREATE INDEX IF NOT EXISTS control_adaptations_created_idx
  ON control_adaptations (created_at);

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

CREATE UNIQUE INDEX IF NOT EXISTS control_digests_week_unique
  ON control_digests (week_start);

-- ————— Row Level Security and PostgREST exposure —————
-- The server uses a direct Postgres connection as the table owner; the
-- Supabase anon/authenticated roles must never see application tables.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE couple_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE couple_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gallery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE render_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_prospect_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_prospect_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_outreach_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_prospect_vetting ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_prospect_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_copy_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_adaptations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_digests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

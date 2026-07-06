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

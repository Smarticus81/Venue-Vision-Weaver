-- Restore the existing bootstrap.sql server-only access contract.
-- Audited production tables are accessed through the Clerk-protected API.
-- No public client policies: postgres/service_role retain their backend access.
-- Idempotent; preserves all rows, including legacy auth pending separate review.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE IF EXISTS public.agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_outreach_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_prospect_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_prospect_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.couple_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.couple_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.generated_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owner_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owner_login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.owner_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.venue_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
COMMIT;

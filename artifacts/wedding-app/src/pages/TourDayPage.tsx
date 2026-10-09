import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, Loader2, Send } from "lucide-react";
import {
  getGetOrganizationQueryKey,
  getGetVenueDashboardQueryKey,
  getListVenueMediaQueryKey,
  useGetOrganization,
  useGetVenueDashboard,
  useListVenueMedia,
  type SessionResponse,
} from "@workspace/api-client-react";
import { ClerkSetupNotice, OrgGate, Pending } from "@/components/auth/OrgGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clerkConfigured } from "@/lib/clerk";
import { usePublicConfig } from "@/lib/publicConfig";
import { localSpendCheck, venueReadiness, type SpendCheck } from "./dashboard/activation";
import { captureHint, captureIssues, COUPLE_NAME_MAX } from "./dashboard/capture";
import { ConsentCheck, CouplePhotoSlots, StylePicker, WeddingMonthSelect } from "./dashboard/CaptureFields";
import { describeApiError } from "./dashboard/errors";
import { formatWeddingMonth } from "./dashboard/galleryStats";
import type { DashboardContext } from "./dashboard/types";
import { Note } from "./dashboard/ui";
import { UpgradePanel } from "./dashboard/UpgradePanel";
import { useBillingActions } from "./dashboard/useBilling";
import { useCoupleCapture } from "./dashboard/useCoupleCapture";

/**
 * Tour-day mode (/dashboard/tour/:slug): the coordinator's phone at the end
 * of a tour. Two or three photos of the couple straight from the camera,
 * their email and wedding month, consent confirmed on their behalf, one
 * thumb-reach button. Sessions are created with createdVia "tour_day" so
 * the venue can see which galleries started on the tour itself.
 */
export default function TourDayPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <OrgGate pendingLabel="Opening tour-day mode">
      <TourDay />
    </OrgGate>
  );
}

function TourDay() {
  const { slug = "" } = useParams<{ slug: string }>();
  const publicConfig = usePublicConfig();
  const orgQuery = useGetOrganization({ query: { queryKey: getGetOrganizationQueryKey() } });
  const dashboard = useGetVenueDashboard(slug, {
    query: { enabled: Boolean(slug), queryKey: getGetVenueDashboardQueryKey(slug), retry: false },
  });
  const mediaQuery = useListVenueMedia(slug, {
    query: { enabled: Boolean(slug), queryKey: getListVenueMediaQueryKey(slug), retry: false },
  });
  const organization = orgQuery.data?.organization;
  const billing = useBillingActions(organization, publicConfig);

  if (dashboard.isError || mediaQuery.isError || orgQuery.isError) {
    const status = describeApiError(dashboard.error ?? mediaQuery.error ?? orgQuery.error).status;
    return (
      <TourFrame>
        <div className="tour-done">
          <h2>{status === 403 || status === 404 ? "This venue is not on your account" : "Tour-day mode did not load"}</h2>
          <p>
            {status === 403 || status === 404
              ? "Open tour-day mode from your own dashboard so it starts on the right venue."
              : "Check the connection, then try again."}
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to the dashboard</Link>
          </Button>
        </div>
      </TourFrame>
    );
  }

  if (!organization || !dashboard.data || !mediaQuery.data) {
    return (
      <TourFrame>
        <Pending label="Opening tour-day mode" />
      </TourFrame>
    );
  }

  const media = mediaQuery.data.media;
  const ctx: DashboardContext = {
    organization,
    venue: dashboard.data.venue,
    slug,
    sessions: dashboard.data.sessions,
    media,
    publicConfig,
    readiness: venueReadiness(media),
    spend: localSpendCheck(organization),
    billing,
    coupleUrl: `${window.location.origin}/preview/${slug}`,
    goTo: (tab) => {
      window.location.assign(`/dashboard#${tab}`);
    },
    refreshMedia: () => mediaQuery.refetch(),
    refreshDashboard: () => dashboard.refetch(),
    refreshOrg: () => orgQuery.refetch(),
  };

  return <TourForm ctx={ctx} />;
}

function TourFrame({ children, credits }: { children: React.ReactNode; credits?: number }) {
  return (
    <div className="tour">
      <header className="tour-head">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        {credits !== undefined ? (
          <span className="tour-credit" aria-label={`${credits} credits left`}>
            Credits <strong>{credits}</strong>
          </span>
        ) : null}
      </header>
      <main id="main-content" className="tour-main">
        {children}
      </main>
    </div>
  );
}

function TourForm({ ctx }: { ctx: DashboardContext }) {
  const { venue, readiness, organization, publicConfig } = ctx;
  const [done, setDone] = useState<{ session: SessionResponse; email: string; month: string | null } | null>(null);
  const [serverSpend, setServerSpend] = useState<SpendCheck | null>(null);
  const spend = serverSpend ?? ctx.spend;

  const capture = useCoupleCapture({
    slug: ctx.slug,
    createdVia: "tour_day",
    onCreated: (session) => {
      setDone({ session, email: capture.coupleEmail.trim().toLowerCase(), month: capture.weddingMonth || null });
      void ctx.refreshOrg();
      window.scrollTo({ top: 0 });
    },
  });

  useEffect(() => {
    const code = capture.failure?.spendCode;
    if (code) {
      setServerSpend({ ok: false, reason: code });
      void ctx.refreshOrg();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.failure?.spendCode]);

  useEffect(() => {
    setServerSpend(null);
  }, [organization.creditsBalance, organization.plan]);

  if (done) {
    const month = formatWeddingMonth(done.month);
    return (
      <TourFrame credits={organization.creditsBalance}>
        <div className="tour-done" role="status" data-testid="tour-done">
          <span className="tour-done-mark" aria-hidden="true">
            <Check className="h-7 w-7" />
          </span>
          <h2>Their gallery is rendering</h2>
          <p>
            {venue.reviewBeforeSend
              ? `It takes a few minutes, then waits under Couple galleries on your dashboard for you to send to ${done.email}`
              : `It takes a few minutes. We email it to ${done.email} as soon as it's ready, and it shows under Couple galleries too`}
            {month ? `, with ${month} on their “Check your date” button` : ""}.
          </p>
          <Button
            type="button"
            variant="brand"
            size="lg"
            onClick={() => {
              capture.reset();
              setDone(null);
            }}
            data-testid="tour-next-couple"
          >
            Next couple
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dashboard">Open the dashboard</Link>
          </Button>
        </div>
      </TourFrame>
    );
  }

  const issues = captureIssues({
    photoCount: capture.photos.length,
    email: capture.coupleEmail,
    weddingMonth: capture.weddingMonth || null,
    consent: capture.consent,
    readiness,
    spend,
  });
  const hint = captureHint(issues, capture.photos.length);
  const canSubmit = issues.length === 0 && !capture.busy;

  return (
    <TourFrame credits={organization.creditsBalance}>
      <div>
        <p className="eyebrow text-brand">Tour day</p>
        <h1 className="mt-2">A gallery for this couple, before they leave {venue.name}</h1>
      </div>

      {!readiness.ready ? (
        <Note tone="warn">
          <strong>Venue photos first.</strong> Add a photo for each of the five views on the dashboard, then come back.
        </Note>
      ) : null}
      {!spend.ok ? <UpgradePanel ctx={ctx} spend={spend} source="tour_day" compact /> : null}

      <form
        id="tour-form"
        className="grid gap-7"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void capture.submit();
        }}
        noValidate
      >
        <section className="tour-step" aria-labelledby="tour-step-photos">
          <div className="tour-step-head">
            <h2 id="tour-step-photos">1. Photos of the two of them</h2>
            <span>2 or 3</span>
          </div>
          <CouplePhotoSlots capture={capture} withCamera idPrefix="tour" />
        </section>

        <section className="tour-step" aria-labelledby="tour-step-details">
          <div className="tour-step-head">
            <h2 id="tour-step-details">2. Where it goes</h2>
          </div>
          <div className="field">
            <label htmlFor="tour-email">Couple's email</label>
            <Input
              id="tour-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              value={capture.coupleEmail}
              onChange={(e) => capture.setCoupleEmail(e.target.value)}
              placeholder="avery@example.com"
              disabled={capture.busy}
              data-testid="tour-email"
            />
          </div>
          <div className="field">
            <label htmlFor="tour-names">
              Names <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="tour-names"
              value={capture.coupleName}
              onChange={(e) => capture.setCoupleName(e.target.value)}
              placeholder="Avery & Jordan"
              maxLength={COUPLE_NAME_MAX}
              autoComplete="off"
              disabled={capture.busy}
            />
          </div>
          <WeddingMonthSelect capture={capture} id="tour-month" />
        </section>

        <StylePicker capture={capture} idPrefix="tour" />

        <section className="tour-step" aria-labelledby="tour-step-consent">
          <div className="tour-step-head">
            <h2 id="tour-step-consent">3. Ask them both</h2>
          </div>
          <ConsentCheck capture={capture} venueName={venue.name} retentionDays={publicConfig.retentionDays} id="tour-consent" />
        </section>

        {capture.failure && !capture.failure.spendCode ? (
          <Note tone="danger" role="alert">
            {capture.failure.message}
          </Note>
        ) : null}
      </form>

      <div className="tour-sticky">
        <div className="tour-sticky-inner">
          <Button type="submit" form="tour-form" variant="brand" size="lg" disabled={!canSubmit} data-testid="tour-submit">
            {capture.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            {capture.stage === "uploading"
              ? "Uploading photos…"
              : capture.stage === "creating"
                ? "Starting their gallery…"
                : "Make their gallery"}
          </Button>
          <p className="tour-sticky-note" aria-live="polite">
            {hint ?? `Uses one credit. ${organization.creditsBalance} left.`}
          </p>
        </div>
      </div>
    </TourFrame>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/clerk-react";
import { Gauge, LogOut, Plus, Smartphone } from "lucide-react";
import {
  getGetOrganizationQueryKey,
  getGetVenueDashboardQueryKey,
  getListVenueMediaQueryKey,
  useGetOrganization,
  useGetVenueDashboard,
  useListVenueMedia,
} from "@workspace/api-client-react";
import { ClerkSetupNotice, OrgGate, Pending } from "@/components/auth/OrgGate";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { Button } from "@/components/ui/button";
import { clerkConfigured } from "@/lib/clerk";
import { useIsOperator } from "@/lib/operatorAccess";
import { usePublicConfig } from "@/lib/publicConfig";
import { track } from "@/lib/track";
import { activationMilestones, localSpendCheck, venueReadiness, type VenueReadiness } from "./dashboard/activation";
import { ActivationChecklist } from "./dashboard/ActivationChecklist";
import { Billing } from "./dashboard/Billing";
import { billingReturnMessage } from "./dashboard/billing";
import { CoupleLinkCard } from "./dashboard/CoupleLinkCard";
import { CreateGallery } from "./dashboard/CreateGallery";
import { cleanedSearch, DASHBOARD_TABS, parseDashboardLocation, tabFromHash } from "./dashboard/dashboardRoute";
import { GalleryList } from "./dashboard/GalleryList";
import { OverviewHeader } from "./dashboard/OverviewHeader";
import { planLabel } from "./dashboard/plans";
import { Settings } from "./dashboard/Settings";
import type { DashboardContext, DashboardTab } from "./dashboard/types";
import { Note } from "./dashboard/ui";
import { useBillingActions, useBillingReturn } from "./dashboard/useBilling";
import { VenuePhotos } from "./dashboard/VenuePhotos";

const SELECTED_VENUE_KEY = "dreemer:dashboard-venue";
/** While a gallery renders, the list refreshes on this cadence. */
const RENDER_POLL_MS = 8000;

function readStoredSlug(): string | null {
  try {
    return localStorage.getItem(SELECTED_VENUE_KEY);
  } catch {
    return null;
  }
}

function storeSlug(slug: string) {
  try {
    localStorage.setItem(SELECTED_VENUE_KEY, slug);
  } catch {
    /* per-browser convenience only */
  }
}

export default function VenueOwnerPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <OrgGate>
      <DashboardShell />
    </OrgGate>
  );
}

function DashboardShell() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const publicConfig = usePublicConfig();
  const isOperator = useIsOperator();

  // One-shot flags (?welcome=1&import=1 from signup, ?billing=success from
  // Stripe) are read once, then stripped so a reload does not replay them.
  const initial = useMemo(() => parseDashboardLocation(window.location.search, window.location.hash), []);
  useEffect(() => {
    const search = cleanedSearch(window.location.search);
    if (search !== window.location.search) {
      window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
    }
  }, []);

  const [tab, setTab] = useState<DashboardTab>(initial.tab ?? "galleries");
  const goTo = useCallback((next: DashboardTab) => {
    setTab(next);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash(window.location.hash);
      if (next) setTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const orgQuery = useGetOrganization({ query: { queryKey: getGetOrganizationQueryKey() } });
  const organization = orgQuery.data?.organization;
  const venues = orgQuery.data?.venues ?? [];
  const [slug, setSlug] = useState<string>("");

  useEffect(() => {
    if (!orgQuery.isSuccess) return;
    const list = orgQuery.data.venues;
    if (list.length === 0) {
      // A cached {venues: []} from before the first venue was created must
      // not bounce a new owner back to signup: decide on fresh data only.
      if (!orgQuery.isFetching) setLocation("/create-venue");
      return;
    }
    setSlug((current) => {
      if (current && list.some((v) => v.slug === current)) return current;
      // A link for one venue (owner email: /dashboard/<slug>) opens that venue.
      if (initial.venue && list.some((v) => v.slug === initial.venue)) {
        storeSlug(initial.venue);
        return initial.venue;
      }
      const stored = readStoredSlug();
      return stored && list.some((v) => v.slug === stored) ? stored : list[0].slug;
    });
  }, [orgQuery.isSuccess, orgQuery.isFetching, orgQuery.data, setLocation, initial.venue]);

  const dashboard = useGetVenueDashboard(slug, {
    query: {
      enabled: Boolean(slug),
      queryKey: getGetVenueDashboardQueryKey(slug),
      refetchInterval: (query) =>
        query.state.data?.sessions.some((s) => s.status === "pending" || s.status === "processing") ? RENDER_POLL_MS : false,
    },
  });
  const mediaQuery = useListVenueMedia(slug, {
    query: { enabled: Boolean(slug), queryKey: getListVenueMediaQueryKey(slug) },
  });

  // A finished render changes the credit balance (refund on failure).
  const renderingCount = dashboard.data?.sessions.filter((s) => s.status === "pending" || s.status === "processing").length ?? 0;
  const lastRendering = useRef(renderingCount);
  useEffect(() => {
    if (renderingCount < lastRendering.current) void orgQuery.refetch();
    lastRendering.current = renderingCount;
  }, [renderingCount, orgQuery]);

  const media = useMemo(() => mediaQuery.data?.media ?? [], [mediaQuery.data]);
  const readiness = useMemo(() => venueReadiness(media), [media]);
  useActivationTracking(slug, mediaQuery.isSuccess ? readiness : null, dashboard.data?.venue.id);

  const billing = useBillingActions(organization, publicConfig);
  const billingReturn = useBillingReturn({ flag: initial.billing, organization, refetch: orgQuery.refetch });

  const switchVenue = (next: string) => {
    setSlug(next);
    storeSlug(next);
  };

  if (orgQuery.isError || dashboard.isError || mediaQuery.isError) {
    return (
      <div className="state-panel">
        <h1>We couldn't open your workspace</h1>
        <p>Check your connection, then try again.</p>
        <Button
          onClick={() => {
            void orgQuery.refetch();
            void dashboard.refetch();
            void mediaQuery.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (!organization || !slug || !dashboard.data || !mediaQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Pending label="Opening your dashboard" />
      </div>
    );
  }

  const venue = dashboard.data.venue;
  const ctx: DashboardContext = {
    organization,
    venue,
    slug,
    sessions: dashboard.data.sessions,
    media,
    publicConfig,
    readiness,
    spend: localSpendCheck(organization),
    billing,
    coupleUrl: `${window.location.origin}/preview/${slug}`,
    goTo,
    refreshMedia: () => mediaQuery.refetch(),
    refreshDashboard: () => dashboard.refetch(),
    refreshOrg: () => orgQuery.refetch(),
  };

  // Short badges so a label never wraps in the 232px rail; the long form is the accessible name.
  const badges: Partial<Record<DashboardTab, { short: string; long: string }>> = {};
  if (!readiness.ready) {
    const n = readiness.missing.length || readiness.needed;
    badges.photos = { short: String(n), long: `${n} ${n === 1 ? "view" : "views"} to add` };
  }
  const rendering = ctx.sessions.filter((s) => s.status === "pending" || s.status === "processing").length;
  if (rendering > 0) badges.galleries = { short: String(rendering), long: `${rendering} rendering` };
  if (!ctx.spend.ok) {
    badges.billing =
      ctx.spend.reason === "trial_expired" ? { short: "Ended", long: "trial ended" } : { short: "0", long: "no credits left" };
  }

  return (
    <div className="dash">
      <aside className="dash-nav" aria-label="Dashboard">
        <DreemerLogo />
        <nav className="dash-nav-links" aria-label="Sections">
          {DASHBOARD_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => goTo(item.id)}
              data-testid={`dash-tab-${item.id}`}
            >
              <span>{item.label}</span>
              {badges[item.id] ? (
                <>
                  <span className="dash-nav-badge" aria-hidden="true">
                    {badges[item.id]!.short}
                  </span>
                  <span className="sr-only">, {badges[item.id]!.long}</span>
                </>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="dash-mobile-nav">
          <label htmlFor="dash-section">Section</label>
          <select id="dash-section" className="dash-select" value={tab} onChange={(e) => goTo(e.target.value as DashboardTab)}>
            {DASHBOARD_TABS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {badges[item.id] ? ` (${badges[item.id]!.long})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="dash-nav-foot dash-nav-links">
          <Link href={`/dashboard/tour/${slug}`}>
            <span>Tour-day mode</span>
            <Smartphone className="h-4 w-4" />
          </Link>
        </div>
      </aside>

      <div className="dash-body">
        <header className="dash-topbar">
          <p className="dash-topbar-org">
            {organization.name} · {planLabel(organization.plan)}
          </p>
          <div className="dash-topbar-actions">
            {venues.length > 1 ? (
              <select value={slug} onChange={(e) => switchVenue(e.target.value)} aria-label="Switch venue">
                {venues.map((v) => (
                  <option key={v.id} value={v.slug}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}
            {isOperator ? (
              <Button variant="ghost" size="sm" onClick={() => setLocation("/control")} data-testid="dash-control-link">
                <Gauge className="h-4 w-4" /> Control
              </Button>
            ) : null}
            {billing.isAdmin ? (
              <Button variant="ghost" size="sm" onClick={() => setLocation("/create-venue")} data-testid="dash-add-venue">
                <Plus className="h-4 w-4" /> Add venue
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
                setLocation("/login");
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </header>

        <main id="main-content" className="dash-main">
          <OverviewHeader ctx={ctx} />

          {billingReturn.state ? (
            <Note
              tone={billingReturn.state === "confirmed" ? "success" : billingReturn.state === "timeout" ? "warn" : "info"}
              role="status"
              actions={
                billingReturn.state !== "confirming" ? (
                  <Button type="button" variant="ghost" size="sm" onClick={billingReturn.dismiss}>
                    Dismiss
                  </Button>
                ) : null
              }
            >
              {billingReturnMessage(billingReturn.state, organization.creditsBalance, planLabel(organization.plan))}
            </Note>
          ) : null}

          {initial.welcome && tab === "photos" && !readiness.ready ? (
            <Note tone="success" role="status">
              <strong>{venue.name} is set up.</strong> Add a photo for each of the five views below and your couple link
              opens.
            </Note>
          ) : null}

          <Nudges ctx={ctx} tab={tab} />

          {tab === "galleries" ? (
            <>
              <ActivationChecklist ctx={ctx} />
              <GalleryList ctx={ctx} />
              {readiness.ready ? <CoupleLinkCard url={ctx.coupleUrl} venueReady /> : null}
            </>
          ) : null}
          {tab === "new" ? <CreateGallery ctx={ctx} /> : null}
          {tab === "photos" ? <VenuePhotos ctx={ctx} importRequested={initial.importRequested} /> : null}
          {tab === "settings" ? <Settings ctx={ctx} /> : null}
          {tab === "billing" ? <Billing ctx={ctx} /> : null}
        </main>
      </div>
    </div>
  );
}

/** One quiet nudge at a time: booking link first (it is where couples land), then the trial clock. */
function Nudges({ ctx, tab }: { ctx: DashboardContext; tab: DashboardTab }) {
  const { venue, organization } = ctx;
  if (tab !== "settings" && !venue.bookingUrl && ctx.readiness.ready) {
    return (
      <Note
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => ctx.goTo("settings")} data-testid="nudge-booking">
            Add booking link
          </Button>
        }
      >
        <strong>Where should “Check your date” go?</strong>{" "}
        {venue.contactEmail || venue.websiteUrl
          ? `Without a booking link, couples land on ${venue.websiteUrl ? "your website" : "an email to you"}. A tour or enquiry page lets them ask about their date directly.`
          : "Add your tour or enquiry page so couples can ask about their date from the gallery."}
      </Note>
    );
  }
  const trial = organization.trial;
  if (tab !== "billing" && trial.onTrial && !trial.expired && trial.daysLeft !== null && trial.daysLeft <= 3) {
    return (
      <Note
        tone="warn"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => ctx.goTo("billing")}>
            See plans
          </Button>
        }
      >
        <strong>
          {trial.daysLeft === 0 ? "Your trial ends today." : `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left on your trial.`}
        </strong>{" "}
        Credits you have left stay on the account after it ends.
      </Note>
    );
  }
  return null;
}

/** Records first_photo and venue_ready when they happen in this session. */
function useActivationTracking(slug: string, readiness: VenueReadiness | null, venueId: number | undefined) {
  const previous = useRef<{ slug: string; value: VenueReadiness } | null>(null);
  useEffect(() => {
    if (!readiness || !slug) return;
    const prior = previous.current && previous.current.slug === slug ? previous.current.value : null;
    for (const event of activationMilestones(prior, readiness)) {
      track(event, { venueId, slug, surface: "dashboard" });
    }
    previous.current = { slug, value: readiness };
  }, [readiness, slug, venueId]);
}

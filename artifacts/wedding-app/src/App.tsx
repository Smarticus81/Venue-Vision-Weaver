import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  Redirect,
  useParams,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import VenueLandingPage from "@/pages/VenueLandingPage";
import { dashboardPathForVenue } from "@/pages/dashboard/dashboardRoute";

const queryClient = new QueryClient();

const CHUNK_RELOAD_KEY = "dreemer:chunk-reloaded";

/**
 * After a redeploy the hashed chunk filenames change, so a browser holding a
 * stale index.html gets a 404 when it lazily imports a route and the page
 * goes blank. Reload once to pick up the fresh index.html; if the import
 * still fails, let the error boundary show its recovery screen.
 */
function lazyRoute<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  return lazy(() =>
    loader().then(
      (module) => {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        return module;
      },
      (error) => {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }
        throw error;
      },
    ),
  );
}

// The landing page is imported statically above so prospects never see the
// route-loading fallback; every other route stays lazy.
//
// framer-motion is only used by the lazy product pages, so its MotionConfig
// (reducedMotion="user") loads with them instead of sitting in the main chunk
// ahead of the landing page's first paint. The landing page uses no JS motion.
const MotionShell = lazyRoute(() =>
  import("framer-motion").then((m) => ({
    default: function Shell({ children }: { children: ReactNode }) {
      return <m.MotionConfig reducedMotion="user">{children}</m.MotionConfig>;
    },
  })),
);
const PricingPage = lazyRoute(() => import("@/pages/PricingPage"));
const PrivacyPage = lazyRoute(() => import("@/pages/PrivacyPage"));
const ClaimPage = lazyRoute(() => import("@/pages/ClaimPage"));
const CreateVenuePage = lazyRoute(() => import("@/pages/CreateVenuePage"));
const VenueOwnerPage = lazyRoute(() => import("@/pages/VenueOwnerPage"));
const CouplePage = lazyRoute(() => import("@/pages/CouplePage"));
const GallerySharePage = lazyRoute(() => import("@/pages/GallerySharePage"));
const FindMyGalleryPage = lazyRoute(() => import("@/pages/FindMyGalleryPage"));
const OwnerLoginPage = lazyRoute(() => import("@/pages/OwnerLoginPage"));
const ControlPlanePage = lazyRoute(() => import("@/pages/ControlPlanePage"));
const TourDayPage = lazyRoute(() => import("@/pages/TourDayPage"));
const NotFound = lazyRoute(() => import("@/pages/not-found"));

function RedirectVenueToPreview() {
  const { slug } = useParams<{ slug: string }>();
  return <Redirect to={`/preview/${slug}`} />;
}

function Router() {
  return (
    <Switch>
      {/* Venue-facing main site: the landing page paints from the main chunk, outside Suspense */}
      <Route path="/">{() => <VenueLandingPage />}</Route>
      <Route>{() => <LazyRoutes />}</Route>
    </Switch>
  );
}

function LazyRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <MotionShell>
      <Switch>
        <Route path="/pricing">{() => <PricingPage />}</Route>
        <Route path="/privacy">{() => <PrivacyPage />}</Route>
        {/* Retired consumer-era couple entry; couples arrive via venue QR codes and links */}
        <Route path="/couple">{() => <Redirect to="/" />}</Route>
        <Route path="/couple-entry">{() => <Redirect to="/" />}</Route>

        {/* Venue owners - marketing, sign-in, registration */}
        <Route path="/venues">{() => <Redirect to="/" />}</Route>
        <Route path="/profiles">{() => <Redirect to="/" />}</Route>
        <Route path="/owner">{() => <Redirect to="/login" />}</Route>
        <Route path="/login">{() => <OwnerLoginPage />}</Route>
        {/* Legacy magic-link path; Clerk owns sign-in now */}
        <Route path="/owner/login">{() => <Redirect to="/login" />}</Route>
        <Route path="/find-my-gallery">{() => <FindMyGalleryPage />}</Route>

        {/* Venue creation */}
        <Route path="/create-venue">{() => <CreateVenuePage />}</Route>
        <Route path="/venue/new">{() => <Redirect to="/create-venue" />}</Route>

        {/* Outreach invitations (claim links in prospect emails) */}
        <Route path="/claim/:token">{() => <ClaimPage />}</Route>

        {/* Platform operators - Autonomous Business Control Plane */}
        <Route path="/control">{() => <ControlPlanePage />}</Route>

        {/* Owner profile/dashboard */}
        <Route path="/dashboard">{() => <VenueOwnerPage />}</Route>
        <Route path="/dashboard/tour/:slug">{() => <TourDayPage />}</Route>
        <Route path="/dashboard/:slug">
          {(params) => <Redirect to={dashboardPathForVenue(params.slug)} />}
        </Route>
        <Route path="/profile/:slug">
          {() => <Redirect to="/dashboard" />}
        </Route>
        <Route path="/venue/:slug/owner">
          {() => <Redirect to="/dashboard" />}
        </Route>

        {/* Couple venue experience; /venue/:slug stays for printed QR codes */}
        <Route path="/preview/:slug">{() => <CouplePage />}</Route>
        <Route path="/venue/:slug" component={RedirectVenueToPreview} />

        {/* Session share links (couple-facing) */}
        <Route path="/v/:shareToken">{() => <GallerySharePage />}</Route>

        <Route>{() => <NotFound />}</Route>
      </Switch>
      </MotionShell>
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <p role="status" className="eyebrow text-brand">
        Opening Dreemer…
      </p>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
        <Router />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;

import { Suspense, lazy, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

const queryClient = new QueryClient();

const CHUNK_RELOAD_KEY = "glimpse:chunk-reloaded";

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

const LandingPage = lazyRoute(() => import("@/pages/LandingPage"));
const VenueLandingPage = lazyRoute(() => import("@/pages/VenueLandingPage"));
const CoupleEntryPage = lazyRoute(() => import("@/pages/CoupleEntryPage"));
const CreateVenuePage = lazyRoute(() => import("@/pages/CreateVenuePage"));
const VenueOwnerPage = lazyRoute(() => import("@/pages/VenueOwnerPage"));
const CouplePage = lazyRoute(() => import("@/pages/CouplePage"));
const GallerySharePage = lazyRoute(() => import("@/pages/GallerySharePage"));
const FindMyGalleryPage = lazyRoute(() => import("@/pages/FindMyGalleryPage"));
const OwnerLoginPage = lazyRoute(() => import("@/pages/OwnerLoginPage"));
const ControlPlanePage = lazyRoute(() => import("@/pages/ControlPlanePage"));
const NotFound = lazyRoute(() => import("@/pages/not-found"));

function RedirectVenueToPreview() {
  const { slug } = useParams<{ slug: string }>();
  return <Redirect to={`/preview/${slug}`} />;
}

function Router() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Switch>
        {/* Venue-facing main site */}
        <Route path="/">{() => <VenueLandingPage />}</Route>
        <Route path="/couple">{() => <LandingPage />}</Route>
        <Route path="/couple-entry">{() => <CoupleEntryPage />}</Route>

        {/* Venue owners - marketing, sign-in, registration */}
        <Route path="/venues">{() => <Redirect to="/" />}</Route>
        <Route path="/profiles">{() => <Redirect to="/" />}</Route>
        <Route path="/owner">{() => <Redirect to="/login" />}</Route>
        <Route path="/login">{() => <OwnerLoginPage />}</Route>
        {/* Legacy magic-link path; Clerk owns sign-in now */}
        <Route path="/owner/login">{() => <Redirect to="/login" />}</Route>
        <Route path="/find-my-gallery">{() => <FindMyGalleryPage />}</Route>
        <Route path="/find-my-videos">{() => <Redirect to="/find-my-gallery" />}</Route>

        {/* Venue creation */}
        <Route path="/create-venue">{() => <CreateVenuePage />}</Route>
        <Route path="/venue/new">
          {() => <Redirect to="/create-venue" />}
        </Route>

        {/* Platform operators - Autonomous Business Control Plane */}
        <Route path="/control">{() => <ControlPlanePage />}</Route>

        {/* Owner profile/dashboard */}
        <Route path="/dashboard">{() => <VenueOwnerPage />}</Route>
        <Route path="/dashboard/:slug">{() => <Redirect to="/dashboard" />}</Route>
        <Route path="/profile/:slug">{() => <Redirect to="/dashboard" />}</Route>
        <Route path="/venue/:slug/owner">{() => <Redirect to="/dashboard" />}</Route>

        {/* Couple venue experience */}
        <Route path="/preview/:slug">{() => <CouplePage />}</Route>
        <Route path="/venue/:slug" component={RedirectVenueToPreview} />

        {/* Session share links (couple-facing) */}
        <Route path="/v/:shareToken">{() => <GallerySharePage />}</Route>

        {/* Legacy integer-id routes */}
        <Route path="/session/:id/processing">
          {() => <Redirect to="/couple" />}
        </Route>
        <Route>{() => <NotFound />}</Route>
      </Switch>
    </Suspense>
  );
}

function RouteLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="h-10 w-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
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

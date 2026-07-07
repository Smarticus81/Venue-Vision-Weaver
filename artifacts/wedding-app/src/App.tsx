import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

const queryClient = new QueryClient();

const LandingPage = lazy(() => import("@/pages/LandingPage"));
const VenueLandingPage = lazy(() => import("@/pages/VenueLandingPage"));
const CoupleEntryPage = lazy(() => import("@/pages/CoupleEntryPage"));
const CreateVenuePage = lazy(() => import("@/pages/CreateVenuePage"));
const VenueOwnerPage = lazy(() => import("@/pages/VenueOwnerPage"));
const CouplePage = lazy(() => import("@/pages/CouplePage"));
const GallerySharePage = lazy(() => import("@/pages/GallerySharePage"));
const FindMyGalleryPage = lazy(() => import("@/pages/FindMyGalleryPage"));
const OwnerLoginPage = lazy(() => import("@/pages/OwnerLoginPage"));
const NotFound = lazy(() => import("@/pages/not-found"));

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

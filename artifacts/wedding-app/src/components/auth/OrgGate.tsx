import { useEffect, useState, type ReactNode } from "react";
import {
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  CreateOrganization,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { FormLayout } from "@/components/layout/SiteChrome";
import {
  clerkConfigured,
  clerkExpectedDomain,
  clerkStatus,
  gardenAppearance,
} from "@/lib/clerk";

export function ClerkSetupNotice() {
  const mismatch = clerkStatus === "domain-mismatch";
  return <FormLayout label="Venue sign-in" title={mismatch ? "Continue to your workspace." : "Sign-in is temporarily unavailable."} description={mismatch ? "Your venue workspace is available at the address below." : "We're getting your workspace ready. Please try again shortly."}>
    {mismatch ? <a className="nav-cta" href={`https://${clerkExpectedDomain}${window.location.pathname}`}>Continue on {clerkExpectedDomain}</a> : <p role="status" className="text-muted-foreground">Please contact your venue support team if this continues.</p>}
  </FormLayout>;
}

function ClerkConnectionFailed() {
  return (
    <div className="relative w-full max-w-md bg-card p-8 text-center">
      <p className="eyebrow mb-4 text-brand">Connection issue</p>
      <h2 className="font-display text-xl font-medium mb-3">Sign-in couldn't load</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        We couldn't reach the sign-in service. Check your connection or any
        content blockers, then reload.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-11 items-center justify-center bg-brand px-6 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover"
      >
        Reload
      </button>
    </div>
  );
}

function ClerkWidgetSpinner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Loader2 className="h-8 w-8 animate-spin text-brand" />
      {slow && (
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          Still connecting to the sign-in service… if this persists, check your
          connection or reload the page.
        </p>
      )}
    </div>
  );
}

/**
 * Wraps a Clerk widget (SignIn/SignUp) so the user always sees something:
 * a spinner while clerk-js loads, a retry card if it fails to load, and the
 * widget itself once ready. Without this the auth pages render an empty
 * main area for as long as clerk-js takes — or forever, if it errors.
 */
export function ClerkWidgetFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <ClerkLoading>
        <ClerkWidgetSpinner />
      </ClerkLoading>
      <ClerkFailed>
        <ClerkConnectionFailed />
      </ClerkFailed>
      <ClerkLoaded>{children}</ClerkLoaded>
    </>
  );
}

function CenteredSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-brand" />
    </div>
  );
}

/**
 * Members sign in to their own profile but always work inside one billing
 * organization. This gate: redirects signed-out visitors to /login,
 * auto-activates the user's single organization membership, and asks brand-new
 * users to name their organization once (Clerk Billing attaches to it).
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { isLoaded: listLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: false },
  });

  useEffect(() => {
    if (userLoaded && !isSignedIn) {
      setLocation("/login");
    }
  }, [userLoaded, isSignedIn, setLocation]);

  // One user → one organization: activate the sole membership automatically.
  useEffect(() => {
    if (!listLoaded || organization || !setActive) return;
    const first = userMemberships?.data?.[0];
    if (first) {
      void setActive({ organization: first.organization.id });
    }
  }, [listLoaded, organization, setActive, userMemberships?.data]);

  if (!clerkConfigured) return <ClerkSetupNotice />;
  if (!userLoaded || !orgLoaded || !listLoaded) {
    // While clerk-js is loading, spin; if it failed to load, say so instead
    // of spinning forever.
    return (
      <>
        <ClerkFailed>
          <div className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
            <ClerkConnectionFailed />
          </div>
        </ClerkFailed>
        <ClerkLoading>
          <CenteredSpinner />
        </ClerkLoading>
        <ClerkLoaded>
          <CenteredSpinner />
        </ClerkLoaded>
      </>
    );
  }
  if (!isSignedIn) return <CenteredSpinner />;

  if (!organization) {
    const hasMembership = (userMemberships?.data?.length ?? 0) > 0;
    if (hasMembership) return <CenteredSpinner />;
    return (
      <div className="relative min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 px-6 py-16">
        <div className="text-center max-w-md">
          <p className="eyebrow mb-4 text-brand">One last step</p>
          <h1 className="font-display text-3xl font-medium mb-3">Name your organization</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your organization owns billing and credits for every venue you add.
            Teammates you invite sign in with their own profiles under it.
          </p>
        </div>
        <CreateOrganization
          appearance={gardenAppearance}
          skipInvitationScreen
          hideSlug
        />
      </div>
    );
  }

  return <>{children}</>;
}

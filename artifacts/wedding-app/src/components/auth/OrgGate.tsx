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
import { FrameTicks } from "@/components/motion";
import {
  clerkConfigured,
  clerkExpectedDomain,
  clerkStatus,
  darkroomAppearance,
} from "@/lib/clerk";

export function ClerkSetupNotice() {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  return (
    <div className="grain relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="relative w-full max-w-md bg-card p-8">
        <FrameTicks size={16} className="text-foreground/40" />
        <p className="mono-label mb-4 text-rose">Setup required</p>
        {clerkStatus === "domain-mismatch" ? (
          <>
            <h1 className="font-display text-2xl font-medium mb-3">
              Sign-in lives on {clerkExpectedDomain}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This page is open at <span className="font-mono">{hostname}</span>, but the
              configured Clerk production key only works on{" "}
              <span className="font-mono">{clerkExpectedDomain}</span> and its subdomains.
            </p>
            <a
              href={`https://${clerkExpectedDomain}${typeof window !== "undefined" ? window.location.pathname : ""}`}
              className="mt-6 inline-flex h-11 items-center justify-center bg-rose px-6 text-sm font-medium text-rose-foreground transition-colors hover:bg-rose-hover"
            >
              Continue on {clerkExpectedDomain}
            </a>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              To sign in from this address instead, use a development{" "}
              <span className="font-mono">pk_test_…</span> key for this environment.
            </p>
          </>
        ) : clerkStatus === "invalid-key" ? (
          <>
            <h1 className="font-display text-2xl font-medium mb-3">Sign-in key is malformed</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The configured Clerk publishable key doesn't look like a valid{" "}
              <span className="font-mono">pk_test_…</span> or{" "}
              <span className="font-mono">pk_live_…</span> key. Check{" "}
              <span className="font-mono">CLERK_PUBLISHABLE_KEY</span> /{" "}
              <span className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</span> in the server
              environment, then redeploy.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-medium mb-3">Sign-in isn't configured yet</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Set <span className="font-mono">VITE_CLERK_PUBLISHABLE_KEY</span> and{" "}
              <span className="font-mono">CLERK_SECRET_KEY</span> in the server environment,
              then redeploy. See <span className="font-mono">.env.example</span>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ClerkConnectionFailed() {
  return (
    <div className="relative w-full max-w-md bg-card p-8 text-center">
      <FrameTicks size={16} className="text-foreground/40" />
      <p className="mono-label mb-4 text-rose">Connection issue</p>
      <h2 className="font-display text-xl font-medium mb-3">Sign-in couldn't load</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        We couldn't reach the sign-in service. Check your connection or any
        content blockers, then reload.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-11 items-center justify-center bg-rose px-6 text-sm font-medium text-rose-foreground transition-colors hover:bg-rose-hover"
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
      <Loader2 className="h-8 w-8 animate-spin text-rose" />
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
      <Loader2 className="h-10 w-10 animate-spin text-rose" />
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
          <div className="grain relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
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
      <div className="grain relative min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 px-6 py-16">
        <div className="text-center max-w-md">
          <p className="mono-label mb-4 text-rose">One last step</p>
          <h1 className="font-display text-3xl font-medium mb-3">Name your organization</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your organization owns billing and credits for every venue you add.
            Teammates you invite sign in with their own profiles under it.
          </p>
        </div>
        <CreateOrganization
          appearance={darkroomAppearance}
          skipInvitationScreen
          hideSlug
        />
      </div>
    );
  }

  return <>{children}</>;
}

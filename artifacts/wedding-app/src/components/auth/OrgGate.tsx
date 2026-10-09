import { useEffect, useState, type ReactNode } from "react";
import {
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useLocation } from "wouter";
import { FormLayout } from "@/components/layout/SiteChrome";
import { clerkConfigured, clerkExpectedDomain, clerkStatus } from "@/lib/clerk";
import { orgGateDecision } from "@/lib/orgGate";

export function ClerkSetupNotice() {
  const mismatch = clerkStatus === "domain-mismatch";
  return (
    <FormLayout
      label="Venue sign-in"
      title={mismatch ? "Continue to your dashboard." : "Sign-in is temporarily unavailable."}
      description={
        mismatch
          ? "Your dashboard is served from the address below."
          : "We're finishing setup on our side. Please try again shortly."
      }
    >
      {mismatch ? (
        <a className="action-primary" href={`https://${clerkExpectedDomain}${window.location.pathname}`}>
          Continue on {clerkExpectedDomain}
        </a>
      ) : (
        <p role="status" className="text-muted-foreground">
          If this keeps happening, reply to any Dreemer email and we will sort it out.
        </p>
      )}
    </FormLayout>
  );
}

/**
 * Loading state with words. The spinner is decorative; the text is what a
 * screen reader announces and what remains under prefers-reduced-motion.
 */
export function Pending({
  label,
  size = "md",
  className,
}: {
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="status" className={["pending", size === "sm" ? "pending-sm" : "", className ?? ""].join(" ").trim()}>
      <span className="pending-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function ClerkConnectionFailed() {
  return (
    <div className="relative w-full max-w-md rounded-lg border border-border bg-card p-8 text-center">
      <p className="eyebrow mb-4 text-brand">Connection issue</p>
      <h2 className="font-display text-xl font-semibold mb-3">Sign-in couldn't load</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        We couldn't reach the sign-in service. Check your connection or any
        content blockers, then reload.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Reload
      </button>
    </div>
  );
}

function ClerkWidgetPending() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Pending label="Connecting to sign-in" />
      {slow && (
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          Still connecting to the sign-in service. If this persists, check your
          connection or reload the page.
        </p>
      )}
    </div>
  );
}

/**
 * Wraps a Clerk widget (SignIn/SignUp) so the user always sees something:
 * a status line while clerk-js loads, a retry card if it fails to load, and
 * the widget itself once ready.
 */
export function ClerkWidgetFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <ClerkLoading>
        <ClerkWidgetPending />
      </ClerkLoading>
      <ClerkFailed>
        <ClerkConnectionFailed />
      </ClerkFailed>
      <ClerkLoaded>{children}</ClerkLoaded>
    </>
  );
}

type GateLayout = "page" | "embedded";

function GateFrame({ layout, children }: { layout: GateLayout; children: ReactNode }) {
  if (layout === "embedded") {
    return <div className="flex w-full flex-col items-center justify-center gap-6 py-6">{children}</div>;
  }
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      {children}
    </div>
  );
}

/**
 * Members sign in to their own profile but always work inside one billing
 * organization. This gate redirects signed-out visitors to /login and
 * auto-activates the user's single organization membership.
 *
 * `layout="embedded"` drops the viewport-tall wrapper so the gate can sit
 * inside the signup card without pushing the page around.
 *
 * `requireOrganization` (default true) sends a signed-in user with no
 * organization to /create-venue, where the organization is created from the
 * venue name. The signup page passes false and handles creation itself.
 */
export function OrgGate({
  children,
  layout = "page",
  requireOrganization = true,
  pendingLabel = "Opening your workspace",
}: {
  children: ReactNode;
  layout?: GateLayout;
  requireOrganization?: boolean;
  pendingLabel?: string;
}) {
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

  const hasMembership = (userMemberships?.data?.length ?? 0) > 0;
  // Clerk reports the list as loaded while the memberships fetch is still in
  // flight (data is [] until it lands): never treat that as "no organization".
  const membershipsPending = Boolean(userMemberships?.isLoading || userMemberships?.isFetching);
  const decision = orgGateDecision({
    userLoaded,
    orgLoaded,
    listLoaded,
    isSignedIn: Boolean(isSignedIn),
    hasOrganization: Boolean(organization),
    hasMembership,
    membershipsPending,
    requireOrganization,
  });

  useEffect(() => {
    if (decision === "create_venue") setLocation("/create-venue");
  }, [decision, setLocation]);

  if (!clerkConfigured) return <ClerkSetupNotice />;
  if (!userLoaded || !orgLoaded || !listLoaded) {
    return (
      <>
        <ClerkFailed>
          <GateFrame layout={layout}>
            <ClerkConnectionFailed />
          </GateFrame>
        </ClerkFailed>
        <ClerkLoading>
          <GateFrame layout={layout}>
            <Pending label={pendingLabel} />
          </GateFrame>
        </ClerkLoading>
        <ClerkLoaded>
          <GateFrame layout={layout}>
            <Pending label={pendingLabel} />
          </GateFrame>
        </ClerkLoaded>
      </>
    );
  }
  if (!isSignedIn) {
    return (
      <GateFrame layout={layout}>
        <Pending label="Taking you to sign-in" />
      </GateFrame>
    );
  }

  if (decision === "wait_for_memberships") {
    return (
      <GateFrame layout={layout}>
        <Pending label={pendingLabel} />
      </GateFrame>
    );
  }
  if (!organization) {
    if (hasMembership) {
      return (
        <GateFrame layout={layout}>
          <Pending label={pendingLabel} />
        </GateFrame>
      );
    }
    if (requireOrganization) {
      return (
        <GateFrame layout={layout}>
          <Pending label="Finishing your setup" />
        </GateFrame>
      );
    }
  }

  return <>{children}</>;
}

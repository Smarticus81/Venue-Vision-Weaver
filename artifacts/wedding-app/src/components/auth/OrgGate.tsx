import { FormLayout } from "@/components/layout/SiteChrome";
import { Link } from "wouter";
import { useEffect, type ReactNode } from "react";
import {
  CreateOrganization,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { clerkConfigured, gardenAppearance } from "@/lib/clerk";

export function ClerkSetupNotice() {
  return (
    <FormLayout
      label="Venue workspace"
      title="We’ll be right with you."
      description="Explore what’s possible while we get this workspace ready."
    >
      <h2>Sign-in is unavailable</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        This workspace is still being set up. Please return later or contact
        your venue team.
      </p>
      <Link href="/" className="text-link">
        Back to glimpse →
      </Link>
    </FormLayout>
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
  const {
    isLoaded: listLoaded,
    userMemberships,
    setActive,
  } = useOrganizationList({
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
  if (!userLoaded || !orgLoaded || !listLoaded) return <CenteredSpinner />;
  if (!isSignedIn) return <CenteredSpinner />;

  if (!organization) {
    const hasMembership = (userMemberships?.data?.length ?? 0) > 0;
    if (hasMembership) return <CenteredSpinner />;
    return (
      <div className="relative min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 px-6 py-16">
        <div className="text-center max-w-md">
          <p className="eyebrow mb-4 text-brand">One last step</p>
          <h1 className="font-display text-3xl font-medium mb-3">
            Name your organization
          </h1>
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

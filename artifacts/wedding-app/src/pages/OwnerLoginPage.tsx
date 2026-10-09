import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { Link, Redirect } from "wouter";
import { ClerkWidgetFrame, ClerkSetupNotice } from "@/components/auth/OrgGate";
import { clerkConfigured, brandAppearance } from "@/lib/clerk";
import { FormLayout } from "@/components/layout/SiteChrome";
import { usePublicConfig } from "@/lib/publicConfig";

export default function OwnerLoginPage() {
  const config = usePublicConfig();
  if (!clerkConfigured) return <ClerkSetupNotice />;
  const trial = config.trial;
  return (
    <FormLayout
      label="Venue sign-in"
      title="Welcome back."
      description="Your galleries, your couple link, and your credits are one sign-in away."
      note={{
        heading: "New venue?",
        body: `Setup takes your venue photos and a booking link. Your first ${trial.credits} galleries are free for ${trial.days} days, no card needed.`,
      }}
    >
      <ClerkWidgetFrame>
        <SignedOut>
          <SignIn
            appearance={brandAppearance}
            routing="hash"
            signUpUrl="/create-venue"
            forceRedirectUrl="/dashboard"
          />
          <Link href="/create-venue" className="text-link">
            New to Dreemer? Create your venue
          </Link>
        </SignedOut>
        <SignedIn>
          <Redirect to="/dashboard" />
        </SignedIn>
      </ClerkWidgetFrame>
    </FormLayout>
  );
}

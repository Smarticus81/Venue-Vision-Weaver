import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { Link, Redirect } from "wouter";
import { ClerkSetupNotice } from "@/components/auth/OrgGate";
import { clerkConfigured, gardenAppearance } from "@/lib/clerk";
import { FormLayout } from "@/components/layout/SiteChrome";
export default function OwnerLoginPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <FormLayout
      label="Your venue workspace"
      title="Welcome back."
      description="Bring your venue to life. Your galleries, couples, and next possibilities are right here."
    >
      <SignedOut>
        <SignIn
          appearance={gardenAppearance}
          routing="hash"
          signUpUrl="/create-venue"
          forceRedirectUrl="/dashboard"
        />
        <Link href="/create-venue" className="text-link">
          New to glimpse? Create your venue
        </Link>
      </SignedOut>
      <SignedIn>
        <Redirect to="/dashboard" />
      </SignedIn>
    </FormLayout>
  );
}

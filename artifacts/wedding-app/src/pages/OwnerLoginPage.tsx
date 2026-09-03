import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { Redirect } from "wouter";
import { ArrowLeft } from "lucide-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { ClerkSetupNotice, ClerkWidgetFrame } from "@/components/auth/OrgGate";
import { clerkConfigured, darkroomAppearance } from "@/lib/clerk";

/**
 * Owner sign-in: a Clerk profile session. Every member belongs to one
 * organization, which owns billing and all venues.
 */
export default function OwnerLoginPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;

  return (
    <div className="grain relative min-h-screen bg-background text-foreground flex flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,hsl(var(--rose)/0.08),transparent_70%)]"
      />
      <header className="relative z-10 flex h-16 items-center justify-between px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/" />
        <a
          href="/"
          className="mono-label inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </a>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <ClerkWidgetFrame>
          <SignedOut>
            <div className="text-center">
              <p className="mono-label mb-3 text-rose">Venue teams</p>
              <h1 className="font-display text-3xl font-medium">Welcome back</h1>
            </div>
            <SignIn
              appearance={darkroomAppearance}
              routing="hash"
              signUpUrl="/create-venue"
              forceRedirectUrl="/dashboard"
            />
            <a
              href="/create-venue"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              New here? Create your organization and first venue
            </a>
          </SignedOut>
          <SignedIn>
            <Redirect to="/dashboard" />
          </SignedIn>
        </ClerkWidgetFrame>
      </main>
    </div>
  );
}

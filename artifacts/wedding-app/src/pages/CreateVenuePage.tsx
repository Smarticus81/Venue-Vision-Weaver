import { FormLayout } from "@/components/layout/SiteChrome";
import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { SignedIn, SignedOut, SignUp, useUser } from "@clerk/clerk-react";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toVenueSlug } from "@/lib/venueSlug";
import { ClerkWidgetFrame, ClerkSetupNotice, OrgGate } from "@/components/auth/OrgGate";
import { clerkConfigured, brandAppearance } from "@/lib/clerk";

/**
 * Onboarding: sign up (Clerk profile) → name the organization (billing
 * tenant, handled by OrgGate) → add the first venue. Existing members land
 * straight on the venue form and can add more venues to the same org.
 */
export default function CreateVenuePage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;

  return (
    <FormLayout
      label="Create your venue"
      title="Set up in one sitting."
      description="Create your sign-in, name your business, and add your first venue. Credits are shared across every venue you add."
      note={{
        heading: "Five galleries free",
        body: "Enough to run it at the end of this week’s tours and see how couples respond. No card needed to start.",
      }}
    >
      <ClerkWidgetFrame>
<SignedOut>
        <div className="flex flex-col items-center gap-6">
          <div className="text-center max-w-md">
            <p className="eyebrow mb-3 text-brand">Step 1 of 3</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Create your sign-in
            </h2>
            <p className="mt-2 text-muted-foreground">
              Next you’ll name your business, then add your first venue.
            </p>
          </div>
          <SignUp
            appearance={brandAppearance}
            routing="hash"
            signInUrl="/login"
            forceRedirectUrl="/create-venue"
          />
        </div>
      </SignedOut>

      <SignedIn>
        <OrgGate>
          <VenueForm />
        </OrgGate>
      </SignedIn>
</ClerkWidgetFrame>
    </FormLayout>
  );
}

function VenueForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    bookingUrl: "",
  });

  const ownerEmail =
    user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = toVenueSlug(formData.name);

    if (!slug) {
      toast({ title: "Venue name required", variant: "destructive" });
      return;
    }
    if (!ownerEmail) {
      toast({
        title: "Your profile has no email address",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug,
          ownerEmail,
          contactEmail: ownerEmail,
          bookingUrl: formData.bookingUrl.trim() || undefined,
          tagline:
            "See yourselves married here, before you leave the tour.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create venue.");
      toast({
        title: "Venue created",
        description: "Your dashboard is ready.",
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "Creation failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
    >
      <div className="relative">
        <div className="mb-8">
          <p className="eyebrow mb-4 text-brand">Step 3 of 3</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Add a venue
          </h2>
          <p className="mt-2 text-muted-foreground">
            Billing and credits stay shared across every venue on your
            account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label
              htmlFor="venue-name"
              className="eyebrow text-muted-foreground"
            >
              Venue name
            </Label>
            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="venue-name"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                className="h-12 pl-11 rounded-md border-input bg-background focus-visible:ring-ring"
                placeholder="The Willow House"
                data-testid="venue-name-input"
                autoComplete="organization"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="booking-url"
              className="eyebrow text-muted-foreground"
            >
              Tour booking link{" "}
              <span className="text-muted-foreground font-normal normal-case">
                (optional)
              </span>
            </Label>
            <Input
              id="booking-url"
              type="url"
              value={formData.bookingUrl}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, bookingUrl: e.target.value }))
              }
              className="h-12 rounded-md border-input bg-background focus-visible:ring-ring"
              placeholder="https://yourvenue.com/tours"
              data-testid="venue-booking-url-input"
              autoComplete="url"
            />
          </div>

          <div className="border-l-2 border-primary pl-4 text-sm leading-relaxed text-muted-foreground">
            Gallery notifications and couple replies go to{" "}
            <span className="text-foreground">
              {ownerEmail || "your profile email"}
            </span>
            . You can change the contact email couples see later, in Venue details.
          </div>

          <Button
            type="submit"
            variant="brand"
            disabled={isSubmitting}
            className="w-full h-12 rounded-md font-semibold mt-4"
            data-testid="create-venue-submit"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create venue <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setLocation("/dashboard")}
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            data-testid="venue-existing-login"
          >
            Back to your dashboard
          </button>
        </div>
      </div>
    </motion.div>
  );
}

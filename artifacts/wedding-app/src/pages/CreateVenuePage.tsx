import { FormLayout } from "@/components/layout/SiteChrome";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  CreateOrganization,
  SignedIn,
  SignedOut,
  SignUp,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { ArrowRight, Building2 } from "lucide-react";
import {
  useCreateVenue,
  useGetOrganization,
  useGetOutreachClaim,
  getGetOrganizationQueryKey,
  getGetOutreachClaimQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { normalizeWebsiteInput, toVenueSlug } from "@/lib/venueSlug";
import { ClerkWidgetFrame, ClerkSetupNotice, OrgGate, Pending } from "@/components/auth/OrgGate";
import { clerkConfigured, brandAppearance } from "@/lib/clerk";
import { usePublicConfig } from "@/pages/dashboard/usePublicConfig";
import { trackFunnel, trackFunnelOnce } from "@/pages/dashboard/funnel";
import { apiErrorMessage, describeApiError } from "@/pages/dashboard/errors";

/**
 * Two-step signup: Clerk sign-up, then the venue form. The billing
 * organization is created from the venue name on submit; only owners who
 * manage several businesses see Clerk's organization form.
 */
export default function CreateVenuePage() {
  const config = usePublicConfig();
  if (!clerkConfigured) return <ClerkSetupNotice />;

  const trialCredits = config.trial.credits;
  const trialDays = config.trial.days;

  return (
    <FormLayout
      label="Create your venue"
      title="Set up in one sitting."
      description="Create your sign-in, then add your venue. Your first galleries are on us, and credits are shared across every venue you add."
      note={{
        heading: `${trialCredits} galleries free`,
        body: `Enough to run it at the end of this week's tours and see how couples respond. ${trialDays} days, no card needed to start.`,
      }}
    >
      <ClerkWidgetFrame>
        <SignedOut>
          <SignUpStep />
        </SignedOut>

        <SignedIn>
          <OrgGate layout="embedded" requireOrganization={false} pendingLabel="Checking your account">
            <VenueForm />
          </OrgGate>
        </SignedIn>
      </ClerkWidgetFrame>
    </FormLayout>
  );
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function SignUpStep() {
  useEffect(() => {
    trackFunnelOnce("signup_started", "signup_started", undefined, "signup");
  }, []);
  // Keep the claim token and any prefill through Clerk's redirect.
  const redirect = `/create-venue${currentSearch()}`;
  return (
    <div className="signup-step">
      <div className="signup-step-head">
        <p className="eyebrow mb-3 text-brand">Step 1 of 2</p>
        <h2 className="font-display text-3xl font-semibold tracking-tight">Create your sign-in</h2>
        <p className="mt-2 text-muted-foreground">Next you add your venue. That is the whole setup.</p>
      </div>
      <SignUp
        appearance={brandAppearance}
        routing="hash"
        signInUrl="/login"
        forceRedirectUrl={redirect}
      />
    </div>
  );
}

interface Prefill {
  claimToken: string | null;
  name: string;
  website: string;
  booking: string;
}

function readPrefill(): Prefill {
  const params = new URLSearchParams(currentSearch());
  return {
    claimToken: params.get("claim")?.trim() || null,
    name: (params.get("venue") ?? params.get("name") ?? "").trim(),
    website: (params.get("website") ?? "").trim(),
    booking: (params.get("booking") ?? "").trim(),
  };
}

function VenueForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useUser();
  const { organization } = useOrganization();
  const { createOrganization, setActive, isLoaded: listLoaded } = useOrganizationList();
  const createVenue = useCreateVenue();
  const prefill = useMemo(readPrefill, []);

  const claimQuery = useGetOutreachClaim(prefill.claimToken ?? "", {
    query: {
      enabled: Boolean(prefill.claimToken),
      queryKey: getGetOutreachClaimQueryKey(prefill.claimToken ?? ""),
      retry: false,
    },
  });

  // Only call GET /org once an organization is active; a brand-new member
  // has none yet and the API would answer 403.
  const orgQuery = useGetOrganization({
    query: { enabled: Boolean(organization), queryKey: getGetOrganizationQueryKey(), retry: false },
  });
  const existingVenues = orgQuery.data?.venues ?? [];
  const hasVenue = existingVenues.length > 0;

  const [form, setForm] = useState({ name: prefill.name, website: prefill.website, booking: prefill.booking });
  const touched = useRef({ name: Boolean(prefill.name), website: Boolean(prefill.website) });
  const [severalBusinesses, setSeveralBusinesses] = useState(false);
  const [submitting, setSubmitting] = useState<null | "organization" | "venue">(null);

  // Claim link prefill lands once the lookup answers, without overwriting
  // anything the owner already typed.
  useEffect(() => {
    const claim = claimQuery.data;
    if (!claim) return;
    setForm((prev) => ({
      name: touched.current.name || prev.name ? prev.name : claim.venueName,
      website: touched.current.website || prev.website ? prev.website : (claim.website ?? ""),
      booking: prev.booking,
    }));
  }, [claimQuery.data]);

  const ownerEmail = user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
  const websiteNormalized = normalizeWebsiteInput(form.website);
  const websiteInvalid = form.website.trim().length > 0 && websiteNormalized === null;
  const bookingNormalized = normalizeWebsiteInput(form.booking);
  const bookingInvalid = form.booking.trim().length > 0 && bookingNormalized === null;

  const needsOrganization = !organization;
  const showOrgWidget = needsOrganization && severalBusinesses;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const slug = toVenueSlug(name);
    if (!slug) {
      toast({ title: "Venue name required", variant: "destructive" });
      return;
    }
    if (websiteInvalid || bookingInvalid) {
      toast({ title: "Check the web addresses", description: "Use a full address like yourvenue.com/tours.", variant: "destructive" });
      return;
    }
    if (!ownerEmail) {
      toast({ title: "Your profile has no email address", description: "Add one in your account, then try again.", variant: "destructive" });
      return;
    }

    try {
      let createdOrg = false;
      if (needsOrganization) {
        if (!createOrganization || !setActive) {
          throw new Error("Your account is still loading. Try again in a moment.");
        }
        setSubmitting("organization");
        const org = await createOrganization({ name });
        await setActive({ organization: org.id });
        createdOrg = true;
        trackFunnel("org_created", { from: "venue_name" }, "signup");
      }

      setSubmitting("venue");
      const body = {
        name,
        slug,
        ownerEmail,
        contactEmail: ownerEmail,
        websiteUrl: websiteNormalized ?? undefined,
        bookingUrl: bookingNormalized ?? undefined,
      };
      let venue;
      try {
        venue = await createVenue.mutateAsync({ data: body });
      } catch (err) {
        // A freshly activated organization can take a beat to reach the
        // session token the API reads; retry once before giving up.
        const failure = describeApiError(err);
        if (createdOrg && failure.status === 403) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          venue = await createVenue.mutateAsync({ data: body });
        } else {
          throw err;
        }
      }

      trackFunnel(
        "venue_created",
        { venueId: venue.id, website: Boolean(websiteNormalized), booking: Boolean(bookingNormalized), claim: Boolean(prefill.claimToken) },
        "signup",
      );
      if (!hasVenue) trackFunnel("signup_completed", { venueId: venue.id }, "signup");

      toast({ title: "Venue created", description: "Your dashboard is ready." });
      const next = new URLSearchParams();
      next.set("welcome", "1");
      if (websiteNormalized) next.set("import", "1");
      setLocation(`/dashboard?${next.toString()}`);
    } catch (err) {
      toast({
        title: "Could not create the venue",
        description: apiErrorMessage(err, "Try again."),
        variant: "destructive",
      });
    } finally {
      setSubmitting(null);
    }
  };

  const nameId = "venue-name";
  const websiteId = "venue-website";
  const bookingId = "booking-url";

  return (
    <div className="w-full">
      <div className="signup-step-head mb-8">
        <p className="eyebrow mb-4 text-brand">{hasVenue ? "Another venue" : "Step 2 of 2"}</p>
        <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {hasVenue ? "Add a venue" : "Add your venue"}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {hasVenue
            ? `New venues share the plan and credits of ${orgQuery.data?.organization.name ?? "your account"}.`
            : "The name couples will see on their gallery. Photos and the rest come next, on your dashboard."}
        </p>
        {prefill.claimToken ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {claimQuery.isLoading
              ? "Looking up the venue from your invitation…"
              : claimQuery.data
                ? `Prefilled from your invitation for ${claimQuery.data.venueName}. Change anything that is off.`
                : "We could not read that invitation link, so start from the venue name."}
          </p>
        ) : null}
      </div>

      {showOrgWidget ? (
        <div className="signup-org-widget">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Name the business that owns your venues. Billing and credits sit there, and every venue you add joins it.
          </p>
          <CreateOrganization appearance={brandAppearance} skipInvitationScreen hideSlug />
          <button
            type="button"
            className="text-link mt-2"
            onClick={() => setSeveralBusinesses(false)}
          >
            Just one venue after all
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor={nameId} className="eyebrow text-muted-foreground">
              Venue name
            </Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={nameId}
                required
                value={form.name}
                onChange={(e) => {
                  touched.current.name = true;
                  setForm((prev) => ({ ...prev, name: e.target.value }));
                }}
                className="h-12 pl-11 rounded-md border-input bg-background focus-visible:ring-ring"
                placeholder="The Willow House"
                data-testid="venue-name-input"
                autoComplete="organization"
                maxLength={120}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={websiteId} className="eyebrow text-muted-foreground">
              Website{" "}
              <span className="text-muted-foreground font-normal normal-case">(optional)</span>
            </Label>
            <Input
              id={websiteId}
              type="url"
              inputMode="url"
              value={form.website}
              onChange={(e) => {
                touched.current.website = true;
                setForm((prev) => ({ ...prev, website: e.target.value }));
              }}
              aria-invalid={websiteInvalid || undefined}
              aria-describedby={`${websiteId}-hint`}
              className="h-12 rounded-md border-input bg-background focus-visible:ring-ring"
              placeholder="yourvenue.com"
              data-testid="venue-website-input"
              autoComplete="url"
            />
            <p id={`${websiteId}-hint`} className={`text-xs leading-relaxed ${websiteInvalid ? "text-danger" : "text-muted-foreground"}`}>
              {websiteInvalid
                ? "That does not look like a web address."
                : "We can pull photos of your spaces from it so your first gallery is minutes away."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={bookingId} className="eyebrow text-muted-foreground">
              Booking or enquiry link{" "}
              <span className="text-muted-foreground font-normal normal-case">(optional)</span>
            </Label>
            <Input
              id={bookingId}
              type="url"
              inputMode="url"
              value={form.booking}
              onChange={(e) => setForm((prev) => ({ ...prev, booking: e.target.value }))}
              aria-invalid={bookingInvalid || undefined}
              aria-describedby={`${bookingId}-hint`}
              className="h-12 rounded-md border-input bg-background focus-visible:ring-ring"
              placeholder="https://yourvenue.com/tours"
              data-testid="venue-booking-url-input"
              autoComplete="url"
            />
            <p id={`${bookingId}-hint`} className={`text-xs leading-relaxed ${bookingInvalid ? "text-danger" : "text-muted-foreground"}`}>
              {bookingInvalid
                ? "That does not look like a web address."
                : "Couples tap “Check your date” on their gallery and land here."}
            </p>
          </div>

          {needsOrganization ? (
            <label className="signup-check">
              <input
                type="checkbox"
                checked={severalBusinesses}
                onChange={(e) => setSeveralBusinesses(e.target.checked)}
                data-testid="venue-several-businesses"
              />
              <span>
                I manage several businesses
                <small>Name the parent business separately from this venue.</small>
              </span>
            </label>
          ) : null}

          <div className="border-l-2 border-primary pl-4 text-sm leading-relaxed text-muted-foreground">
            Gallery notifications go to <span className="text-foreground">{ownerEmail || "your profile email"}</span>.
            You can change the contact email couples see later, in Settings.
          </div>

          <Button
            type="submit"
            variant="brand"
            disabled={submitting !== null || !listLoaded}
            className="w-full h-12 rounded-md font-semibold mt-4"
            data-testid="create-venue-submit"
          >
            {submitting === "organization"
              ? "Setting up your account…"
              : submitting === "venue"
                ? "Creating your venue…"
                : "Create venue"}
            {submitting ? null : <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
          {submitting ? <Pending size="sm" label={submitting === "organization" ? "Creating your account" : "Saving your venue"} className="justify-center" /> : null}
        </form>
      )}

      {hasVenue ? (
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
      ) : null}
    </div>
  );
}

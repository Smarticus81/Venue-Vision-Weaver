import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Save, Smartphone } from "lucide-react";
import { useUpdateOrganization, useUpdateVenue } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { normalizeWebsiteInput } from "@/lib/venueSlug";
import { isValidEmail } from "./capture";
import { CoupleLinkCard } from "./CoupleLinkCard";
import { apiErrorMessage } from "./errors";
import { TourCardButton } from "./TourCardButton";
import type { DashboardContext } from "./types";
import { Field, SectionHead, Toggle } from "./ui";

/** Matches UpdateVenueBody.incentiveText maxLength in the API contract. */
export const INCENTIVE_MAX = 160;

interface VenueForm {
  name: string;
  contactEmail: string;
  websiteUrl: string;
  bookingUrl: string;
  incentiveText: string;
}

function formFromVenue(venue: DashboardContext["venue"]): VenueForm {
  return {
    name: venue.name ?? "",
    contactEmail: venue.contactEmail ?? venue.ownerEmail ?? "",
    websiteUrl: venue.websiteUrl ?? "",
    bookingUrl: venue.bookingUrl ?? "",
    incentiveText: venue.incentiveText ?? "",
  };
}

/**
 * Venue details couples see (booking link first: it is where "Check your
 * date" lands), the incentive line under their reel, the couple link and
 * tour card, and organization settings an admin controls.
 */
export function Settings({ ctx }: { ctx: DashboardContext }) {
  const { toast } = useToast();
  const { venue, slug } = ctx;
  const updateVenue = useUpdateVenue();
  const [form, setForm] = useState<VenueForm>(() => formFromVenue(venue));

  useEffect(() => {
    setForm(formFromVenue(venue));
    // Reset only when switching venues, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.id]);

  const booking = normalizeWebsiteInput(form.bookingUrl);
  const website = normalizeWebsiteInput(form.websiteUrl);
  const bookingInvalid = form.bookingUrl.trim() !== "" && booking === null;
  const websiteInvalid = form.websiteUrl.trim() !== "" && website === null;
  const emailInvalid = form.contactEmail.trim() !== "" && !isValidEmail(form.contactEmail);
  const nameMissing = form.name.trim() === "";
  const incentive = form.incentiveText.trim();
  const invalid = bookingInvalid || websiteInvalid || emailInvalid || nameMissing || incentive.length > INCENTIVE_MAX;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    try {
      await updateVenue.mutateAsync({
        slug,
        data: {
          name: form.name.trim(),
          contactEmail: form.contactEmail.trim().toLowerCase() || null,
          websiteUrl: website,
          bookingUrl: booking,
          incentiveText: incentive || null,
        },
      });
      toast({ title: "Venue details saved" });
      void ctx.refreshDashboard();
    } catch (err) {
      toast({ title: "Save failed", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  const set = (key: keyof VenueForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <section className="dash-section" aria-labelledby="settings-title">
      <SectionHead id="settings-title" title="Settings" description="What couples see on their gallery, and how your account works." />

      <div className="dash-grid-settings">
        <form className="dash-card grid gap-5" onSubmit={save} noValidate aria-labelledby="venue-details-title">
          <h3 id="venue-details-title" className="text-base font-semibold">
            Venue details
          </h3>
          <Field
            id="set-booking"
            label="Booking or enquiry link"
            hint={
              bookingInvalid
                ? "That does not look like a web address."
                : "Every gallery's “Check your date” button opens this, with the couple's wedding month."
            }
            hintTone={bookingInvalid ? "danger" : undefined}
          >
            <Input
              id="set-booking"
              type="url"
              inputMode="url"
              value={form.bookingUrl}
              onChange={set("bookingUrl")}
              placeholder="yourvenue.com/tours"
              aria-invalid={bookingInvalid || undefined}
              aria-describedby="set-booking-hint"
              data-testid="settings-booking-url"
            />
          </Field>
          <Field id="set-name" label="Venue name" hint={nameMissing ? "Add the venue's name." : undefined} hintTone="danger">
            <Input id="set-name" value={form.name} onChange={set("name")} maxLength={120} autoComplete="organization" />
          </Field>
          <Field
            id="set-email"
            label="Enquiry email"
            hint={emailInvalid ? "Check the email address." : "Couples without a booking link reach you here."}
            hintTone={emailInvalid ? "danger" : undefined}
          >
            <Input id="set-email" type="email" value={form.contactEmail} onChange={set("contactEmail")} aria-describedby="set-email-hint" />
          </Field>
          <Field
            id="set-website"
            label="Website"
            optional
            hint={websiteInvalid ? "That does not look like a web address." : "Used to import photos of your spaces."}
            hintTone={websiteInvalid ? "danger" : undefined}
          >
            <Input id="set-website" type="url" inputMode="url" value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="yourvenue.com" aria-describedby="set-website-hint" />
          </Field>
          <Field
            id="set-incentive"
            label="A line for couples"
            optional
            hint={`Shown under their reel, e.g. “Book by June and the rehearsal dinner room is on us.” ${incentive.length}/${INCENTIVE_MAX}`}
            hintTone={incentive.length > INCENTIVE_MAX ? "danger" : undefined}
          >
            <textarea
              id="set-incentive"
              value={form.incentiveText}
              onChange={set("incentiveText")}
              maxLength={INCENTIVE_MAX + 40}
              rows={2}
              aria-describedby="set-incentive-hint"
              data-testid="settings-incentive"
            />
          </Field>
          <Button type="submit" variant="outline" disabled={invalid || updateVenue.isPending} data-testid="settings-save">
            {updateVenue.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save details
          </Button>
        </form>

        <div className="grid content-start gap-6">
          <CoupleLinkCard url={ctx.coupleUrl} venueReady={ctx.readiness.ready} />
          <DeliverySettings ctx={ctx} />
          <div className="dash-card grid gap-3">
            <h3 className="text-base font-semibold">At the tour</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Print the tour card for the desk, or open tour-day mode on your phone and make the gallery with the couple
              before they leave.
            </p>
            <div className="flex flex-wrap gap-2">
              <TourCardButton ctx={ctx} />
              <Button asChild variant="ghost">
                <Link href={`/dashboard/tour/${slug}`}>
                  <Smartphone className="h-4 w-4" /> Tour-day mode
                </Link>
              </Button>
            </div>
          </div>
          <OrganizationSettings ctx={ctx} />
        </div>
      </div>
    </section>
  );
}

/**
 * How ready galleries reach the couple: emailed automatically (default) or
 * held under Galleries until someone at the venue sends them.
 */
function DeliverySettings({ ctx }: { ctx: DashboardContext }) {
  const { toast } = useToast();
  const updateVenue = useUpdateVenue();
  const reviewFirst = ctx.venue.reviewBeforeSend;

  const toggle = async (next: boolean) => {
    try {
      await updateVenue.mutateAsync({ slug: ctx.slug, data: { reviewBeforeSend: next } });
      toast({
        title: next ? "Galleries will wait for you" : "Galleries go straight to couples",
        description: next
          ? "Ready galleries stay under Galleries until you send them."
          : "Each couple gets their link by email as soon as the gallery is ready.",
      });
      void ctx.refreshDashboard();
    } catch (err) {
      toast({ title: "Not saved", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  return (
    <div className="dash-card grid gap-2" aria-labelledby="delivery-settings-title">
      <h3 id="delivery-settings-title" className="text-base font-semibold">
        Sending galleries
      </h3>
      <Toggle
        title="Review each gallery before the couple gets it"
        body={
          reviewFirst
            ? "On: ready galleries wait under Galleries until you press Send."
            : "Off: the couple gets their link by email as soon as the gallery is ready, with your “Check your date” button."
        }
        checked={reviewFirst}
        onChange={(next) => void toggle(next)}
        disabled={updateVenue.isPending}
        testId="settings-review-before-send"
      />
    </div>
  );
}

function OrganizationSettings({ ctx }: { ctx: DashboardContext }) {
  const { toast } = useToast();
  const { organization, billing } = ctx;
  const update = useUpdateOrganization();
  const [contactEmail, setContactEmail] = useState(organization.contactEmail ?? "");

  useEffect(() => {
    setContactEmail(organization.contactEmail ?? "");
  }, [organization.contactEmail]);

  const emailInvalid = contactEmail.trim() !== "" && !isValidEmail(contactEmail);
  const disabledReason = billing.isAdmin ? null : "Only organization admins can change this.";

  const patch = async (data: { shareAggregates?: boolean; contactEmail?: string | null }, done: string) => {
    try {
      await update.mutateAsync({ data });
      toast({ title: done });
      void ctx.refreshOrg();
    } catch (err) {
      toast({ title: "Not saved", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  return (
    <div className="dash-card grid gap-2" aria-labelledby="org-settings-title">
      <h3 id="org-settings-title" className="text-base font-semibold">
        {organization.name}
      </h3>
      <Toggle
        title="Count our galleries in Dreemer's public numbers"
        body="Adds your venue's totals (galleries opened, date clicks, bookings) to the anonymous figures on Dreemer's site. No names, no photos, no couple details."
        checked={organization.shareAggregates}
        onChange={(next) =>
          void patch({ shareAggregates: next }, next ? "Your totals will count toward the public numbers" : "Your totals are private again")
        }
        disabled={!billing.isAdmin || update.isPending}
        reason={disabledReason}
        testId="settings-share-aggregates"
      />
      <form
        className="grid gap-3 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!emailInvalid) void patch({ contactEmail: contactEmail.trim().toLowerCase() || null }, "Account email saved");
        }}
      >
        <div className="field">
          <label htmlFor="org-contact-email">Account email</label>
          <Input
            id="org-contact-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={!billing.isAdmin}
            aria-describedby="org-contact-email-hint"
          />
          <p id="org-contact-email-hint" className="field-hint" data-tone={emailInvalid ? "danger" : undefined}>
            {emailInvalid ? "Check the email address." : "Where we send trial, credit and billing notes."}
          </p>
        </div>
        <Button type="submit" variant="outline" size="sm" className="justify-self-start" disabled={!billing.isAdmin || emailInvalid || update.isPending}>
          Save
        </Button>
      </form>
    </div>
  );
}

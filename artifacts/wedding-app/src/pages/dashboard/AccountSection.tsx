import type { FormEvent } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BILLING_PRODUCTS, type BillingProductId } from "./types";

export type VenueProfileDraft = { name: string; contactEmail: string; bookingUrl: string };

type Organization = {
  name: string;
  plan: string;
  creditsBalance: number;
  billingPeriodEnd?: string | null;
  billingConfigured?: boolean;
};

type Props = {
  profile: VenueProfileDraft;
  onProfileChange: (patch: Partial<VenueProfileDraft>) => void;
  onSaveProfile: () => void;
  saving: boolean;
  dirty: boolean;
  organization?: Organization;
  onCheckout: (product: BillingProductId) => void;
  checkoutPending: BillingProductId | null;
  onOpenPortal: () => void;
  portalPending: boolean;
};

const PLAN_LABEL: Record<string, string> = {
  trial: "Free trial",
  starter: "Starter",
  growth: "Growth",
  none: "No plan",
};

export function AccountSection({
  profile,
  onProfileChange,
  onSaveProfile,
  saving,
  dirty,
  organization,
  onCheckout,
  checkoutPending,
  onOpenPortal,
  portalPending,
}: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSaveProfile();
  };
  const plan = organization?.plan ?? "trial";
  const subscribed = plan === "starter" || plan === "growth";

  return (
    <div className="grid gap-10 border-t border-border pt-6 lg:grid-cols-2 lg:gap-14">
      <section aria-labelledby="venue-details-title">
        <p className="mono-label mb-3 text-rose">Venue details</p>
        <h2 id="venue-details-title" className="font-display text-2xl font-medium tracking-tight md:text-3xl">
          What couples see
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your name heads every gallery. The booking link is the button under it.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="venue-name" className="mono-label text-muted-foreground">
              Venue name
            </Label>
            <Input
              id="venue-name"
              required
              value={profile.name}
              onChange={(e) => onProfileChange({ name: e.target.value })}
              className="h-11 border-border bg-background px-4"
              autoComplete="organization"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="booking-url" className="mono-label text-muted-foreground">
              Tour booking link
            </Label>
            <Input
              id="booking-url"
              type="url"
              inputMode="url"
              value={profile.bookingUrl}
              onChange={(e) => onProfileChange({ bookingUrl: e.target.value })}
              className="h-11 border-border bg-background px-4"
              placeholder="https://yourvenue.com/tours"
              autoComplete="url"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-email" className="mono-label text-muted-foreground">
              Inquiry email
            </Label>
            <Input
              id="contact-email"
              type="email"
              inputMode="email"
              value={profile.contactEmail}
              onChange={(e) => onProfileChange({ contactEmail: e.target.value })}
              className="h-11 border-border bg-background px-4"
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">Shown when there's no booking link.</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="rose" disabled={saving || !dirty} className="h-10 px-5" data-testid="save-venue-details">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {!dirty && !saving && <span className="text-xs text-muted-foreground">Saved</span>}
          </div>
        </form>
      </section>

      <section aria-labelledby="billing-title">
        <p className="mono-label mb-3 text-rose">Billing</p>
        <h2 id="billing-title" className="font-display text-2xl font-medium tracking-tight md:text-3xl">
          {organization?.name ?? "Your organization"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One plan and one credit pool across every venue you run. A gallery costs one credit.
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-4 border-y border-border py-4">
          <div>
            <dt className="mono-label text-muted-foreground">Plan</dt>
            <dd className="mt-1.5 text-base font-medium">{PLAN_LABEL[plan] ?? plan}</dd>
          </div>
          <div>
            <dt className="mono-label text-muted-foreground">Credits</dt>
            <dd className="mono-figure mt-1.5 text-base font-medium">
              <span className={cn(organization && organization.creditsBalance <= 0 && "text-red-300")}>
                {organization?.creditsBalance ?? 0}
              </span>
            </dd>
          </div>
          <div>
            <dt className="mono-label text-muted-foreground">{subscribed ? "Renews" : "Renewal"}</dt>
            <dd className="mt-1.5 text-base font-medium">
              {organization?.billingPeriodEnd
                ? new Date(organization.billingPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                : "—"}
            </dd>
          </div>
        </dl>

        <ul className="mt-2 divide-y divide-border">
          {BILLING_PRODUCTS.map((product) => {
            const current = plan === product.id;
            const pending = checkoutPending === product.id;
            return (
              <li key={product.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {product.title}
                    {current && <span className="mono-label ml-2 text-emerald-300">Current</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {product.credits} · {product.description}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={product.kind === "pack" ? "rose" : "outline"}
                  size="sm"
                  disabled={current || checkoutPending !== null}
                  onClick={() => onCheckout(product.id)}
                  className="h-9 shrink-0"
                  data-testid={`billing-${product.id}`}
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {current ? "Current plan" : product.cta}
                </Button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          disabled={portalPending}
          onClick={onOpenPortal}
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          data-testid="billing-portal"
        >
          {portalPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          Invoices and payment method in Stripe
        </button>
      </section>
    </div>
  );
}

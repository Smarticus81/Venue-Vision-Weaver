import { ExternalLink, Loader2 } from "lucide-react";
import { getGetOrgCreditHistoryQueryKey, useGetOrgCreditHistory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { billingGuard, buildBillingCards, creditReasonLabel, type BillingCard } from "./billing";
import { shortDate } from "./galleryStats";
import { isSubscriptionPlan, planLabel } from "./plans";
import { readOrgExtras, type DashboardContext } from "./types";
import { Note, SectionHead } from "./ui";

/**
 * Plan & credits. Prices come from the public config (the same numbers as
 * the landing page), "Switch plan" goes through the Stripe portal so an
 * organization never holds two subscriptions, buttons explain themselves
 * when billing is not configured or the member is not an admin, and the
 * ledger shows every credit in and out, the trial grant included.
 */
export function Billing({ ctx }: { ctx: DashboardContext }) {
  const { organization, publicConfig, billing } = ctx;
  const extras = readOrgExtras(organization);
  const cards = buildBillingCards(publicConfig);
  const subscribed = isSubscriptionPlan(organization.plan);
  const label = publicConfig.pricing.label;
  const trial = organization.trial;

  let summary: string;
  if (trial.onTrial && trial.expired) {
    summary = "Your free trial has ended. Credits you have left stay on the account; pick a plan or add a pack to use them.";
  } else if (trial.onTrial) {
    summary = `Free trial: ${trial.daysLeft ?? publicConfig.trial.days} ${trial.daysLeft === 1 ? "day" : "days"} left, no card on file.`;
  } else if (organization.plan === "payg") {
    summary = "Pay as you go: credit packs only, no monthly fee. Credits never expire.";
  } else if (subscribed && extras.cancelAtPeriodEnd && organization.billingPeriodEnd) {
    summary = `${planLabel(organization.plan)} ends on ${shortDate(organization.billingPeriodEnd)}. Resume it any time before then.`;
  } else if (subscribed && organization.billingPeriodEnd) {
    summary = `${planLabel(organization.plan)} renews on ${shortDate(organization.billingPeriodEnd)} and tops up your credits.`;
  } else if (subscribed) {
    summary = `${planLabel(organization.plan)}: credits top up on each renewal.`;
  } else {
    summary = "No plan right now. Add a pack or start a plan to keep making galleries.";
  }

  return (
    <section className="dash-section" aria-labelledby="billing-title" id="pricing">
      <SectionHead
        id="billing-title"
        title="Plan & credits"
        description="One plan covers every venue on your account. Each gallery uses one credit; a failed gallery is refunded."
        aside={
          subscribed || organization.firstPaidAt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={billing.openPortal}
              disabled={!billing.isAdmin || !billing.billingConfigured || billing.portalPending}
              data-testid="billing-portal"
            >
              {billing.portalPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Invoices and card
            </Button>
          ) : null
        }
      />

      <div className="dash-card dash-card-tight grid gap-1">
        <p className="eyebrow text-muted-foreground">
          {planLabel(organization.plan)} · {organization.creditsBalance}{" "}
          {organization.creditsBalance === 1 ? "credit" : "credits"}
        </p>
        <p className="text-sm leading-relaxed">{summary}</p>
      </div>

      {extras.subscriptionStatus === "past_due" ? (
        <Note
          tone="danger"
          role="alert"
          actions={
            billing.isAdmin ? (
              <Button type="button" variant="outline" size="sm" onClick={billing.openPortal}>
                Update card
              </Button>
            ) : null
          }
        >
          <strong>The last payment failed.</strong> Stripe will retry; update the card so renewals keep topping up your
          credits.
        </Note>
      ) : null}
      {!billing.billingConfigured ? (
        <Note tone="warn">Payments are not switched on for this server yet, so plans cannot be bought here.</Note>
      ) : !billing.isAdmin ? (
        <Note>Only organization admins can change the plan or buy credits. Ask an admin on your team.</Note>
      ) : null}

      <div className="plan-cards" data-testid="plan-cards">
        {cards.map((card) => (
          <PlanCard key={card.id} card={card} ctx={ctx} cancelAtPeriodEnd={extras.cancelAtPeriodEnd} />
        ))}
      </div>
      <p className="field-hint">
        {label ? `${label}. ` : ""}Monthly plans, cancel any time in the billing portal. Stripe handles payment; we
        never see your card.
      </p>

      <CreditHistory />
    </section>
  );
}

function PlanCard({
  card,
  ctx,
  cancelAtPeriodEnd,
}: {
  card: BillingCard;
  ctx: DashboardContext;
  cancelAtPeriodEnd: boolean;
}) {
  const { organization, billing, publicConfig } = ctx;
  const guard = billingGuard({
    product: card.id,
    plan: organization.plan,
    isAdmin: billing.isAdmin,
    billingConfigured: billing.billingConfigured,
    cancelAtPeriodEnd,
    packCredits: publicConfig.pricing.creditPackCredits,
  });
  const pending = billing.checkoutPending === card.id;
  const onClick = () => {
    if (guard.current && cancelAtPeriodEnd) billing.openPortal();
    else billing.startCheckout(card.id, "billing_tab");
  };
  return (
    <article
      className="plan-card"
      data-recommended={card.recommended && !guard.current ? "true" : "false"}
      data-current={guard.current ? "true" : "false"}
      data-testid={`plan-card-${card.id}`}
    >
      {guard.current ? (
        <span className="plan-card-flag">Your plan</span>
      ) : card.recommended ? (
        <span className="plan-card-flag">Recommended</span>
      ) : null}
      <h3>{card.title}</h3>
      <p className="plan-price">
        {card.price}
        <small>
          {card.credits} · {card.perGallery}
        </small>
      </p>
      <p>{card.description}</p>
      <div className="plan-card-foot">
        <Button
          type="button"
          variant={card.recommended && !guard.current ? "brand" : "outline"}
          disabled={guard.disabled || (billing.checkoutPending !== null && !pending)}
          onClick={onClick}
          data-testid={`billing-${card.id}`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {guard.label}
        </Button>
        {guard.viaPortal ? (
          <p className="plan-reason">Opens Stripe to change your plan; the price difference is prorated.</p>
        ) : guard.reason ? (
          <p className="plan-reason">{guard.reason}</p>
        ) : null}
      </div>
    </article>
  );
}

function CreditHistory() {
  const history = useGetOrgCreditHistory({
    query: { queryKey: getGetOrgCreditHistoryQueryKey(), staleTime: 30_000 },
  });
  const rows = history.data?.transactions ?? [];
  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold">Credit history</h3>
      {history.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading history…
        </p>
      ) : history.isError ? (
        <p className="text-sm text-muted-foreground">The history did not load. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credit changes yet.</p>
      ) : (
        <ul className="ledger" data-testid="credit-ledger">
          {rows.slice(0, 25).map((row) => (
            <li key={row.id} className="ledger-row">
              <time dateTime={row.createdAt}>{shortDate(row.createdAt)}</time>
              <span>{creditReasonLabel(row.reason)}</span>
              <span className="ledger-delta" data-sign={row.delta >= 0 ? "plus" : "minus"}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { billingGuard, buildBillingCards } from "./billing";
import { ownerSpendCopy } from "./errors";
import type { SpendCheck } from "./activation";
import type { BillingActions, DashboardContext } from "./types";

/**
 * The inline upgrade moment: shown where the owner hit the wall (Create a
 * gallery at zero credits, or an expired trial), with the two buttons that
 * fix it and the real prices beside them. One coral button only.
 */
export function UpgradePanel({
  ctx,
  spend,
  source,
  compact = false,
}: {
  ctx: Pick<DashboardContext, "organization" | "venue" | "publicConfig" | "billing" | "goTo">;
  spend: SpendCheck;
  source: string;
  compact?: boolean;
}) {
  if (spend.ok) return null;
  const copy = ownerSpendCopy(spend.reason, ctx.venue.name);
  if (!copy) return null;
  const cards = buildBillingCards(ctx.publicConfig);
  const pack = cards.find((c) => c.id === "credit_pack")!;
  const starter = cards.find((c) => c.id === "starter")!;
  const growth = cards.find((c) => c.id === "growth")!;
  // A Starter org that runs dry is offered a pack and the step up to Growth
  // (through the portal), never its own plan again.
  const plan = ctx.organization.plan;
  const primaryPlan = copy.fix === "plan" && plan !== "starter" && plan !== "growth" ? starter : pack;
  const secondaryPlan =
    plan === "growth" ? null : plan === "starter" ? growth : primaryPlan.id === "starter" ? pack : starter;
  const label = ctx.publicConfig.pricing.label;

  return (
    <div className="upgrade-panel" role="region" aria-label="Upgrade" data-testid="upgrade-panel">
      <div>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
      </div>
      <div className="upgrade-panel-actions">
        <ActionButton ctx={ctx} product={primaryPlan.id} variant="brand" source={source} price={`${primaryPlan.price} · ${primaryPlan.credits}`} />
        {secondaryPlan ? (
          <ActionButton ctx={ctx} product={secondaryPlan.id} variant="outline" source={source} price={`${secondaryPlan.price} · ${secondaryPlan.credits}`} />
        ) : null}
        {!compact ? (
          <Button type="button" variant="ghost" onClick={() => ctx.goTo("billing")} data-testid="upgrade-see-plans">
            Compare plans
          </Button>
        ) : null}
      </div>
      <p className="upgrade-panel-price">
        {label ? `${label}. ` : ""}
        Growth is {growth.price} for {growth.credits}. Credits are shared across every venue on your account.
      </p>
    </div>
  );
}

function ActionButton({
  ctx,
  product,
  variant,
  source,
  price,
}: {
  ctx: { organization: DashboardContext["organization"]; billing: BillingActions; publicConfig: DashboardContext["publicConfig"] };
  product: "starter" | "growth" | "credit_pack";
  variant: "brand" | "outline";
  source: string;
  price: string;
}) {
  const guard = billingGuard({
    product,
    plan: ctx.organization.plan,
    isAdmin: ctx.billing.isAdmin,
    billingConfigured: ctx.billing.billingConfigured,
    packCredits: ctx.publicConfig.pricing.creditPackCredits,
  });
  const pending = ctx.billing.checkoutPending === product;
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={guard.disabled || ctx.billing.checkoutPending !== null}
        onClick={() => ctx.billing.startCheckout(product, source)}
        data-testid={`upgrade-${product}`}
        title={price}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {guard.label}
      </Button>
      <span className="text-xs text-muted-foreground">{guard.reason ?? price}</span>
    </div>
  );
}

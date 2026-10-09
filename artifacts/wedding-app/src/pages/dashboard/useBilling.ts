import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCreateOrgBillingCheckout,
  useCreateOrgBillingPortal,
  type OrganizationResponseOrganization,
  type PublicConfig,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  billingChanged,
  BILLING_POLL_INTERVAL_MS,
  checkoutConflictUrl,
  isOrgAdmin,
  pollAttempts,
  saveCheckoutSnapshot,
  takeCheckoutSnapshot,
  type BillingReturnState,
  type BillingSnapshot,
} from "./billing";
import { apiErrorMessage } from "./errors";
import type { BillingActions, BillingProductId } from "./types";

function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Checkout and portal for the dashboard. A plan change on a subscribed
 * organization comes back as 409 subscription_exists with a Stripe portal
 * url, which we follow instead of opening a second subscription.
 */
export function useBillingActions(
  organization: OrganizationResponseOrganization | undefined,
  publicConfig: PublicConfig,
): BillingActions {
  const { toast } = useToast();
  const checkout = useCreateOrgBillingCheckout();
  const portal = useCreateOrgBillingPortal();
  const [checkoutPending, setCheckoutPending] = useState<BillingProductId | null>(null);

  const startCheckout = useCallback(
    (product: BillingProductId, source: string) => {
      if (!organization) return;
      setCheckoutPending(product);
      saveCheckoutSnapshot(sessionStore(), {
        plan: organization.plan,
        creditsBalance: organization.creditsBalance,
        billingPeriodEnd: organization.billingPeriodEnd ?? null,
        product,
        at: Date.now(),
      });
      checkout.mutate(
        { data: { product } },
        {
          onSuccess: (data) => window.location.assign(data.url),
          onError: (err) => {
            const portalUrl = checkoutConflictUrl(err);
            if (portalUrl) {
              window.location.assign(portalUrl);
              return;
            }
            takeCheckoutSnapshot(sessionStore());
            setCheckoutPending(null);
            toast({
              title: "Checkout did not open",
              description: apiErrorMessage(err, "Try again in a moment."),
              variant: "destructive",
            });
          },
        },
      );
      void source;
    },
    [checkout, organization, toast],
  );

  const openPortal = useCallback(() => {
    portal.mutate(undefined, {
      onSuccess: (data) => window.location.assign(data.url),
      onError: (err) =>
        toast({
          title: "The billing portal did not open",
          description: apiErrorMessage(err, "Try again in a moment."),
          variant: "destructive",
        }),
    });
  }, [portal, toast]);

  return {
    startCheckout,
    openPortal,
    checkoutPending,
    portalPending: portal.isPending,
    isAdmin: isOrgAdmin(organization?.role),
    billingConfigured: organization?.billingConfigured ?? publicConfig.billingConfigured,
  };
}

/**
 * The return trip from Stripe (?billing=success). Compares GET /org with the
 * snapshot taken before checkout and polls every few seconds until the
 * webhook has landed, then says so; after the deadline it says Stripe has
 * not confirmed yet rather than pretending.
 */
export function useBillingReturn({
  flag,
  organization,
  refetch,
}: {
  flag: "success" | "cancel" | null;
  organization: OrganizationResponseOrganization | undefined;
  refetch: () => Promise<{ data?: { organization: OrganizationResponseOrganization } }>;
}): { state: BillingReturnState | null; dismiss: () => void } {
  const [state, setState] = useState<BillingReturnState | null>(flag === "cancel" ? "cancelled" : flag ? "confirming" : null);
  const started = useRef(false);
  const before = useRef<BillingSnapshot | null>(null);
  const unmounted = useRef(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(
    () => () => {
      unmounted.current = true;
    },
    [],
  );

  // Runs once per page load; refetches change `organization`, so the poll
  // loop must not be torn down by this effect's dependencies.
  useEffect(() => {
    if (flag !== "success" || started.current || !organization) return;
    started.current = true;
    const snapshot = takeCheckoutSnapshot(sessionStore());
    before.current = snapshot;
    const current: BillingSnapshot = {
      plan: organization.plan,
      creditsBalance: organization.creditsBalance,
      billingPeriodEnd: organization.billingPeriodEnd ?? null,
    };
    if (snapshot && billingChanged(snapshot, current)) {
      setState("confirmed");
      return;
    }
    let attempts = pollAttempts();
    const tick = async () => {
      if (unmounted.current) return;
      attempts -= 1;
      const result = await refetchRef.current().catch(() => null);
      const org = result?.data?.organization;
      if (unmounted.current) return;
      if (org) {
        const next: BillingSnapshot = {
          plan: org.plan,
          creditsBalance: org.creditsBalance,
          billingPeriodEnd: org.billingPeriodEnd ?? null,
        };
        const reference = before.current ?? current;
        if (billingChanged(reference, next)) {
          setState("confirmed");
          return;
        }
      }
      if (attempts <= 0) {
        // Without a snapshot we cannot tell "already applied" from "late";
        // a paid plan or a first payment on record reads as applied.
        if (!before.current && org && (org.firstPaidAt || org.plan === "starter" || org.plan === "growth" || org.plan === "payg")) {
          setState("confirmed");
        } else {
          setState("timeout");
        }
        return;
      }
      window.setTimeout(() => void tick(), BILLING_POLL_INTERVAL_MS);
    };
    window.setTimeout(() => void tick(), BILLING_POLL_INTERVAL_MS);
  }, [flag, organization]);

  return { state, dismiss: () => setState(null) };
}

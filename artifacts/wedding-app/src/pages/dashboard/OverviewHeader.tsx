import { Button } from "@/components/ui/button";
import { planLabel } from "./plans";
import { summarizeGalleries } from "./galleryStats";
import type { DashboardContext } from "./types";

/**
 * The first screen: venue name, readiness, credits (the one coral figure),
 * the trial clock, the plan, and this month's proof in the venue's unit:
 * galleries sent, viewed, clicked for a date, booked.
 */
export function OverviewHeader({ ctx }: { ctx: DashboardContext }) {
  const { organization, venue, sessions, readiness, publicConfig, billing } = ctx;
  const trial = organization.trial;
  const cancelAtPeriodEnd = organization.cancelAtPeriodEnd === true;
  const stats = summarizeGalleries(sessions);
  const trialDays = publicConfig.trial.days;
  const daysLeft = trial.daysLeft ?? null;
  const clockPct =
    trial.onTrial && daysLeft !== null && trialDays > 0
      ? Math.max(0, Math.min(100, Math.round((daysLeft / trialDays) * 100)))
      : null;
  const lowCredits = organization.creditsBalance <= 1;

  let creditNote: string;
  if (trial.onTrial && trial.expired) creditNote = "Trial ended. Pick a plan to keep going.";
  else if (organization.creditsBalance === 0) creditNote = "Out of credits. Each gallery uses one.";
  else if (lowCredits) creditNote = "One gallery left.";
  else creditNote = "One credit per gallery, shared across your venues.";

  let planNote: string;
  if (trial.onTrial && daysLeft !== null) {
    planNote = trial.expired
      ? "Credits stay on the account."
      : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left of ${trialDays}`;
  } else if (cancelAtPeriodEnd && organization.billingPeriodEnd) {
    planNote = `Ends ${new Date(organization.billingPeriodEnd).toLocaleDateString()}`;
  } else if (organization.billingPeriodEnd) {
    planNote = `Renews ${new Date(organization.billingPeriodEnd).toLocaleDateString()}`;
  } else if (organization.plan === "payg") {
    planNote = "Credit packs, no monthly fee.";
  } else if (organization.subscriptionStatus === "past_due") {
    planNote = "Last payment failed. Update your card in Stripe.";
  } else {
    planNote = "No plan yet.";
  }

  return (
    <section className="dash-overview" aria-labelledby="dash-venue-name">
      <div className="dash-overview-row">
        <h1 id="dash-venue-name">{venue.name}</h1>
        <p className={readiness.ready ? "dash-status text-success" : "dash-status text-brand"}>
          {readiness.ready
            ? "Ready for couples"
            : readiness.count === 0
              ? "Needs venue photos"
              : `${readiness.missing.length} ${readiness.missing.length === 1 ? "view" : "views"} still missing`}
        </p>
      </div>

      <div className="dash-stat-row">
        <div className="dash-stat dash-stat-hero">
          <p className="eyebrow text-muted-foreground">Credits</p>
          <p className="dash-stat-value" data-testid="dash-credits">
            {organization.creditsBalance}
          </p>
          <p className="dash-stat-note">{creditNote}</p>
          {(trial.expired || organization.creditsBalance === 0) && (
            <Button
              type="button"
              variant="brand"
              size="sm"
              className="mt-1 w-fit"
              onClick={() => ctx.goTo("billing")}
              data-testid="dash-credits-upgrade"
            >
              {billing.billingConfigured ? "Add credits" : "See plans"}
            </Button>
          )}
        </div>

        <div className="dash-stat">
          <p className="eyebrow text-muted-foreground">Plan</p>
          <p className="dash-stat-value text-[22px]">{planLabel(organization.plan)}</p>
          <p className="dash-stat-note">{planNote}</p>
          {clockPct !== null && (
            <div
              className="dash-clock"
              data-low={daysLeft !== null && daysLeft <= 3 ? "true" : "false"}
              role="progressbar"
              aria-label="Trial time remaining"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={clockPct}
            >
              <span style={{ width: `${clockPct}%` }} />
            </div>
          )}
        </div>

        <div className="dash-stat">
          <p className="eyebrow text-muted-foreground">Galleries</p>
          <p className="dash-stat-value">{stats.couples}</p>
          <p className="dash-stat-note">
            {stats.inProgress > 0
              ? `${stats.inProgress} rendering now`
              : stats.failed > 0
                ? `${stats.failed} failed, credits refunded`
                : stats.ready > 0
                  ? `${stats.ready} ready`
                  : "Your first one starts here."}
          </p>
        </div>

        <div className="dash-stat">
          <p className="eyebrow text-muted-foreground">Booked dates</p>
          <p className="dash-stat-value">{stats.booked}</p>
          <p className="dash-stat-note">
            {stats.bookedRate !== null
              ? `${stats.bookedRate}% of ready galleries`
              : stats.clicked > 0
                ? `${stats.clicked} ${stats.clicked === 1 ? "couple" : "couples"} clicked for a date`
                : "Mark a couple as booked when they sign."}
          </p>
        </div>
      </div>
    </section>
  );
}

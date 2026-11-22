import { Button } from "@/components/ui/button";
import { planLabel } from "./plans";
import { summarizeGalleries } from "./galleryStats";
import type { DashboardContext } from "./types";

/**
 * Lead with venue sales activity; keep plan, credits and trial time accessible.
 * Counts describe recorded gallery activity, not inferred conversion uplift.
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
      <p className="revenue-eyebrow">VENUE SALES WORKSPACE</p>
      <div className="dash-overview-row">
        <h1 id="dash-venue-name">{venue.name}</h1>
        <p className={readiness.ready ? "dash-status text-success" : "dash-status text-brand"}>
          {readiness.ready ? "Ready for tours" : readiness.count === 0 ? "Needs venue photos" : `${readiness.missing.length} views still missing`}
        </p>
      </div>
      <div className="dash-stat-row">
        <div className="dash-stat"><p className="eyebrow">Galleries sent</p><p className="dash-stat-value">{stats.sent}</p><p className="dash-stat-note">{stats.inProgress > 0 ? `${stats.inProgress} rendering now` : `${stats.ready} galleries ready`}</p></div>
        <div className="dash-stat"><p className="eyebrow">Viewed</p><p className="dash-stat-value">{stats.viewed}</p><p className="dash-stat-note">Couples who opened their gallery.</p></div>
        <div className="dash-stat"><p className="eyebrow">Date-link clicks</p><p className="dash-stat-value">{stats.clicked}</p><p className="dash-stat-note">Couples who took the next step.</p></div>
        <div className="dash-stat"><p className="eyebrow">Marked booked</p><p className="dash-stat-value text-brand">{stats.booked}</p><p className="dash-stat-note">Bookings recorded by your team.</p></div>
      </div>
      <div className="dash-account-strip">
        <div><strong data-testid="dash-credits">{organization.creditsBalance}</strong> credits available <span>{creditNote}</span></div>
        <div><strong>{planLabel(organization.plan)}</strong><span>{planNote}</span>
          {clockPct !== null && <div className="dash-clock" data-low={daysLeft !== null && daysLeft <= 3 ? "true" : "false"} role="progressbar" aria-label="Trial time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clockPct}><span style={{width:`${clockPct}%`}}/></div>}
        </div>
        <Button type="button" variant={lowCredits || trial.expired ? "brand" : "outline"} size="sm" onClick={()=>ctx.goTo("billing")} data-testid="dash-credits-upgrade">{billing.billingConfigured ? "Manage credits" : "See plans"}</Button>
      </div>
    </section>
  );
}

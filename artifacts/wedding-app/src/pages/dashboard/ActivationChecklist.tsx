import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeActivation, type ActivationStepId } from "./activation";
import { TourCardButton } from "./TourCardButton";
import type { DashboardContext } from "./types";

const STEP_COPY: Record<ActivationStepId, { title: string; body: string; action: string }> = {
  photos: {
    title: "Add five venue photos",
    body: "One for each view: exterior, ceremony, reception, a detail, natural light. Every gallery is built from them.",
    action: "Add photos",
  },
  booking_link: {
    title: "Add your booking link",
    body: "Couples tap “Check your date” on their gallery and land here. A website or inquiry email works too.",
    action: "Add link",
  },
  tour_card: {
    title: "Download your tour card",
    body: "A printable card with the QR code. Hand it to couples at the end of the tour, or keep it at the desk.",
    action: "Download card",
  },
  first_gallery: {
    title: "Make your first gallery",
    body: "Run it for the next couple who tours, or make one for yourselves to see the result.",
    action: "Create a gallery",
  },
  plan: {
    title: "Pick a plan",
    body: "Keep going after the free galleries. Prices are on the Plan & credits page.",
    action: "See plans",
  },
};

/**
 * Five steps from a fresh venue to a paying one. Hidden once everything is
 * done; collapsible once the first gallery exists so it stops shouting.
 */
export function ActivationChecklist({ ctx }: { ctx: DashboardContext }) {
  const { organization, venue, readiness, sessions } = ctx;
  const coupleGalleries = sessions.filter((s) => s.kind !== "sample").length;
  const activation = computeActivation({
    readiness,
    bookingUrl: venue.bookingUrl ?? venue.websiteUrl ?? venue.contactEmail,
    tourCardDownloadedAt: venue.tourCardDownloadedAt,
    coupleGalleries,
    plan: organization.plan,
    firstPaidAt: organization.firstPaidAt,
  });
  const [collapsed, setCollapsed] = useState(false);

  if (activation.complete) return null;

  const pct = Math.round((activation.doneCount / activation.total) * 100);

  return (
    <section className="dash-card dash-section" aria-labelledby="activation-title" data-testid="activation-checklist">
      <div className="dash-section-head">
        <div>
          <p className="eyebrow text-brand">Getting started</p>
          <h2 id="activation-title" className="mt-1">
            {activation.doneCount === 0
              ? "Your first gallery in a few minutes"
              : `${activation.total - activation.doneCount} ${activation.total - activation.doneCount === 1 ? "step" : "steps"} to go`}
          </h2>
        </div>
        <div className="checklist-progress" aria-hidden={collapsed ? undefined : true}>
          <div className="checklist-progress-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span>
            {activation.doneCount} of {activation.total}
          </span>
          {coupleGalleries > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
              {collapsed ? "Show" : "Hide"}
            </Button>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <ol className="checklist">
          {activation.steps.map((step, index) => {
            const copy = STEP_COPY[step.id];
            const next = activation.next === step.id;
            return (
              <li key={step.id} className="checklist-item" data-done={step.done ? "true" : "false"} data-next={next ? "true" : "false"}>
                <span className="checklist-index" aria-hidden="true">
                  {step.done ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <div className="min-w-0">
                  <p className="checklist-title">
                    {copy.title}
                    {step.done ? <span className="sr-only"> (done)</span> : null}
                  </p>
                  {!step.done ? (
                    <p className="checklist-body">
                      {copy.body}
                      {step.detail ? ` ${step.detail} so far.` : ""}
                    </p>
                  ) : null}
                </div>
                {!step.done ? <StepAction ctx={ctx} step={step.id} label={copy.action} primary={next} /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function StepAction({ ctx, step, label, primary }: { ctx: DashboardContext; step: ActivationStepId; label: string; primary: boolean }) {
  if (step === "tour_card") {
    return <TourCardButton ctx={ctx} variant={primary ? "brand" : "outline"} size="sm" label={label} />;
  }
  const tab = step === "photos" ? "photos" : step === "booking_link" ? "settings" : step === "first_gallery" ? "new" : "billing";
  return (
    <Button type="button" variant={primary ? "brand" : "outline"} size="sm" onClick={() => ctx.goTo(tab)} data-testid={`activation-${step}`}>
      {label}
    </Button>
  );
}

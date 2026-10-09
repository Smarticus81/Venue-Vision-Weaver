import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { SpendCheck } from "./activation";
import { captureHint, captureIssues, COUPLE_NAME_MAX } from "./capture";
import { ConsentCheck, CouplePhotoSlots, StylePicker, WeddingMonthSelect } from "./CaptureFields";
import { UpgradePanel } from "./UpgradePanel";
import { useCoupleCapture } from "./useCoupleCapture";
import type { DashboardContext } from "./types";
import { Field, Note, SectionHead } from "./ui";

/**
 * Start a couple's gallery from the desk: names, email, wedding month, 2-3
 * photos, style, consent. Gated on venue readiness and on having a credit
 * (or a live trial); when the owner is out, the upgrade panel sits right
 * here with checkout one click away.
 */
export function CreateGallery({ ctx }: { ctx: DashboardContext }) {
  const { toast } = useToast();
  const { slug, venue, readiness, publicConfig, organization } = ctx;
  // A 402 from the server overrides the local check until the org refreshes.
  const [serverSpend, setServerSpend] = useState<SpendCheck | null>(null);
  const spend: SpendCheck = serverSpend ?? ctx.spend;

  useEffect(() => {
    setServerSpend(null);
  }, [organization.creditsBalance, organization.plan]);

  const capture = useCoupleCapture({
    slug,
    onCreated: () => {
      toast({
        title: "Gallery started",
        description: "It takes a few minutes and shows under Couple galleries while it renders.",
      });
      capture.reset();
      void ctx.refreshDashboard();
      void ctx.refreshOrg();
      ctx.goTo("galleries");
    },
  });

  useEffect(() => {
    const code = capture.failure?.spendCode;
    if (code) {
      setServerSpend({ ok: false, reason: code });
      void ctx.refreshOrg();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.failure?.spendCode]);

  const issues = captureIssues({
    photoCount: capture.photos.length,
    email: capture.coupleEmail,
    weddingMonth: capture.weddingMonth || null,
    consent: capture.consent,
    readiness,
    spend,
  });
  const hint = captureHint(issues, capture.photos.length);
  const canSubmit = issues.length === 0 && !capture.busy;

  return (
    <section className="dash-section" aria-labelledby="create-gallery-title">
      <SectionHead
        id="create-gallery-title"
        title="Create a couple's gallery"
        description="Four AI previews of the couple at your venue plus a short reel, ready to send with your booking link."
        aside={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/dashboard/tour/${slug}`} data-testid="open-tour-day">
              <Smartphone className="h-4 w-4" /> Tour-day mode
            </Link>
          </Button>
        }
      />

      {!readiness.ready ? (
        <Note
          tone="warn"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => ctx.goTo("photos")}>
              Add venue photos
            </Button>
          }
        >
          <strong>Venue photos first.</strong> Galleries are built from one photo of each view;{" "}
          {readiness.needed} more {readiness.needed === 1 ? "is" : "are"} needed.
        </Note>
      ) : null}

      {!spend.ok ? <UpgradePanel ctx={ctx} spend={spend} source="create_gallery" /> : null}

      <form
        className="dash-card create-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void capture.submit();
        }}
        noValidate
      >
        <div className="grid content-start gap-5">
          <Field id="cg-names" label="Names" optional>
            <Input
              id="cg-names"
              value={capture.coupleName}
              onChange={(e) => capture.setCoupleName(e.target.value)}
              placeholder="Avery & Jordan"
              maxLength={COUPLE_NAME_MAX}
              autoComplete="off"
              disabled={capture.busy}
              data-testid="owner-couple-name"
            />
          </Field>
          <Field id="cg-email" label="Couple's email" hint="Their gallery link goes here. Nothing else is sent to them.">
            <Input
              id="cg-email"
              type="email"
              inputMode="email"
              value={capture.coupleEmail}
              onChange={(e) => capture.setCoupleEmail(e.target.value)}
              placeholder="avery@example.com"
              autoComplete="off"
              disabled={capture.busy}
              aria-describedby="cg-email-hint"
              data-testid="owner-couple-email"
            />
          </Field>
          <WeddingMonthSelect capture={capture} id="cg-month" />
          <StylePicker capture={capture} idPrefix="cg" />
        </div>

        <div className="grid content-start gap-5">
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Photos of the couple</p>
            <CouplePhotoSlots capture={capture} idPrefix="owner-couple" />
          </div>
          <ConsentCheck capture={capture} venueName={venue.name} retentionDays={publicConfig.retentionDays} id="cg-consent" />

          {capture.failure && !capture.failure.spendCode ? (
            <Note tone="danger" role="alert">
              {capture.failure.message}
            </Note>
          ) : null}

          <div className="grid gap-2">
            <Button type="submit" variant="brand" size="lg" disabled={!canSubmit} data-testid="owner-start-gallery">
              {capture.busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {capture.stage === "uploading"
                ? "Uploading photos…"
                : capture.stage === "creating"
                  ? "Starting the gallery…"
                  : "Create gallery"}
            </Button>
            <p className="field-hint" aria-live="polite">
              {hint ??
                `Uses one credit. ${organization.creditsBalance} ${organization.creditsBalance === 1 ? "credit" : "credits"} left. A gallery that fails is refunded.`}
            </p>
          </div>
        </div>
      </form>
    </section>
  );
}

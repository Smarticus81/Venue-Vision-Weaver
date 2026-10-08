import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useMarkTourCardDownloaded } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, isNotImplemented } from "./errors";
import { trackFunnel } from "./funnel";
import { buildTourCardSvg, extractQrSvg, tourCardFileName, TOUR_CARD_HEIGHT, TOUR_CARD_WIDTH } from "./tourCard";
import type { DashboardContext } from "./types";

/**
 * Builds the printable tour card (venue name, QR to the couple link, plain
 * instructions, the AI-preview line) in the browser, downloads it as a PNG,
 * then records the download so the checklist and the funnel know.
 */
export function TourCardButton({
  ctx,
  variant = "outline",
  size = "default",
  label = "Download tour card",
}: {
  ctx: Pick<DashboardContext, "venue" | "slug" | "coupleUrl" | "refreshDashboard">;
  variant?: "brand" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default";
  label?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const mark = useMarkTourCardDownloaded();

  const handle = async () => {
    setBusy(true);
    try {
      const QRCode = await import("qrcode");
      const qr = await QRCode.toString(ctx.coupleUrl, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#000000ff", light: "#ffffff00" },
      });
      const { inner, viewBox } = extractQrSvg(qr);
      const svg = buildTourCardSvg({ venueName: ctx.venue.name, url: ctx.coupleUrl, qrSvg: inner, qrViewBox: viewBox });
      const png = await rasterize(svg, TOUR_CARD_WIDTH, TOUR_CARD_HEIGHT);
      const a = document.createElement("a");
      a.href = png;
      a.download = tourCardFileName(ctx.slug);
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (png.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(png), 10_000);

      trackFunnel("tour_card_downloaded", { venueId: ctx.venue.id });
      try {
        await mark.mutateAsync({ slug: ctx.slug });
        void ctx.refreshDashboard();
      } catch (err) {
        // The checklist tick is a nicety; the card itself already downloaded.
        if (!isNotImplemented(err)) {
          toast({ title: "Card downloaded", description: "We could not record it on your checklist yet." });
          return;
        }
      }
      toast({ title: "Tour card downloaded", description: "Print it at A6 or larger. The QR opens your couple link." });
    } catch (err) {
      toast({ title: "Could not build the card", description: apiErrorMessage(err, "Try again in a moment."), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant={variant} size={size} onClick={handle} disabled={busy} data-testid="tour-card-download">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </Button>
  );
}

async function rasterize(svg: string, width: number, height: number): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("The card image could not be drawn."));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot draw the card.");
    context.drawImage(img, 0, 0, width, height);
    return await new Promise<string>((resolve, reject) => {
      canvas.toBlob((out) => {
        if (!out) {
          reject(new Error("The card could not be saved."));
          return;
        }
        resolve(URL.createObjectURL(out));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

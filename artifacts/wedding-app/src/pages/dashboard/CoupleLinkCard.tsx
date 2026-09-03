import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The hand-off. Every gallery starts with a couple opening this link, so it
 * lives at the top of the dashboard with its QR code, ready to print or paste
 * into a follow-up email.
 */
export function CoupleLinkCard({ url, venueReady }: { url: string; venueReady: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async (QRCode) => {
      const [markup, dataUrl] = await Promise.all([
        QRCode.toString(url, {
          type: "svg",
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#f1ece4", light: "#00000000" },
        }),
        QRCode.toDataURL(url, {
          width: 1024,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        }),
      ]);
      if (!cancelled) {
        setSvg(markup);
        setPng(dataUrl);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const display = url.replace(/^https?:\/\//, "");

  return (
    <section
      aria-labelledby="couple-link-title"
      className="relative flex flex-col gap-5 border border-card-border bg-card p-5 sm:flex-row sm:items-start sm:p-6"
    >
      <div
        className="relative mx-auto grid h-32 w-32 shrink-0 place-items-center bg-background p-2.5 sm:mx-0"
        role="img"
        aria-label={`QR code for ${url}`}
      >
        {svg ? (
          <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <div className="h-full w-full animate-pulse bg-secondary" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="mono-label text-rose" id="couple-link-title">
          Your couple link
        </p>
        <p className="mt-2 font-mono text-sm text-foreground [overflow-wrap:anywhere]" data-testid="couple-link-url">
          {display}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {venueReady
            ? "Print the code for tour cards, or paste the link into your follow-up email."
            : "Add a venue photo below and this link opens for couples."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="rose"
            onClick={async () => setCopied(await copyText(url))}
            className={cn("h-10 px-4", copied && "border-emerald-400/30 bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/15")}
            data-testid="couple-link-copy"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button asChild variant="outline" className="h-10 px-4" data-testid="couple-link-open">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Open
            </a>
          </Button>
          {png && (
            <a
              href={png}
              download="glimpse-couple-qr.png"
              className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="h-4 w-4" /> QR as PNG
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

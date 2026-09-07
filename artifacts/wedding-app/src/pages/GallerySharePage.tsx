import {
  SiteHeader,
  SiteFooter,
  FormLayout,
} from "@/components/layout/SiteChrome";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  getGetSessionByTokenQueryKey,
  useGetSessionByToken,
  type GeneratedAsset,
  type SessionDetailResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { copyShareLink, shareSession } from "@/lib/shareSession";
import {
  CalendarCheck,
  Download,
  ExternalLink,
  Globe,
  Link,
  Loader2,
  Mail,
  Phone,
  RotateCcw,
  Share2,
} from "lucide-react";
import { motion } from "framer-motion";

function storageAssetUrl(
  objectKey: string,
  shareToken?: string | null,
): string {
  const token = shareToken
    ? `?shareToken=${encodeURIComponent(shareToken)}`
    : "";
  return `/api/storage${objectKey}${token}`;
}

function sortedGalleryStills(session: SessionDetailResponse): GeneratedAsset[] {
  return [...(session.generatedAssets ?? [])]
    .filter((asset) => asset.assetType === "image")
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function motionReel(session: SessionDetailResponse): GeneratedAsset | null {
  return (
    session.generatedAssets?.find(
      (asset) => asset.assetType === "video" && asset.displayOrder === 0,
    ) ?? null
  );
}

function venueContactAction(venue: SessionDetailResponse["venue"]): {
  href: string;
  label: string;
  icon: "calendar" | "globe" | "mail" | "phone";
} | null {
  if (!venue) return null;
  if (venue.bookingUrl) {
    return { href: venue.bookingUrl, label: "Book a tour", icon: "calendar" };
  }
  if (venue.websiteUrl) {
    return { href: venue.websiteUrl, label: "Visit venue site", icon: "globe" };
  }
  if (venue.contactEmail) {
    return {
      href: `mailto:${venue.contactEmail}?subject=${encodeURIComponent(`glimpse gallery at ${venue.name}`)}`,
      label: "Contact venue",
      icon: "mail",
    };
  }
  if (venue.contactPhone) {
    return {
      href: `tel:${venue.contactPhone.replace(/[^\d+]/g, "")}`,
      label: "Call venue",
      icon: "phone",
    };
  }
  return null;
}

function VenueContactIcon({
  icon,
}: {
  icon: "calendar" | "globe" | "mail" | "phone";
}) {
  if (icon === "calendar") return <CalendarCheck className="h-4 w-4" />;
  if (icon === "globe") return <Globe className="h-4 w-4" />;
  if (icon === "phone") return <Phone className="h-4 w-4" />;
  return <Mail className="h-4 w-4" />;
}

export default function GallerySharePage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [, setLocation] = useLocation();

  const tokenQuery = useGetSessionByToken(shareToken || "", {
    query: {
      queryKey: getGetSessionByTokenQueryKey(shareToken || ""),
      enabled: !!shareToken,
retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "processing" ? 3000 : false;
      },
    },
  });

  const session = tokenQuery.data;

  if (!shareToken) return <NotAvailable />;

  if (tokenQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6">
        <Loader2 className="h-12 w-12 animate-spin text-brand" />
        <p className="eyebrow text-muted-foreground">Opening your gallery…</p>
      </div>
    );
  }

  if (tokenQuery.isError || !session) return <NotAvailable />;

  const venueSlug = session.venue?.slug ?? "";
  const onRestart = () =>
    setLocation(venueSlug ? `/preview/${venueSlug}` : "/couple");
  const stills = sortedGalleryStills(session);
  const reel = motionReel(session);

  const status = session.status as string;

  if (status === "pending" || status === "processing") {
    return <ProcessingView session={session} />;
  }

  if (status === "failed" && stills.length === 0) {
    return (
      <FailureView
        onRestart={onRestart}
        message={
          session.errorMessage ??
          "We couldn't finish this gallery. Please try once more."
        }
      />
    );
  }

  if (stills.length > 0) {
    return (
      <GalleryVisionView
        session={session}
        reel={reel}
        stills={stills}
        onRestart={onRestart}
      />
    );
  }

  return <GalleryUnavailable session={session} />;
}

function NotAvailable() {
  const [, navigate] = useLocation();
  return (
    <FormLayout
      label="Your gallery link"
      title="Let’s bring your day back."
      description="A private link is all you need to return to your wedding vision."
    >
      <h2>We couldn’t open this gallery</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        The link may be incorrect or expired. Find your gallery with the email
        you used to create it.
      </p>
      <Button
        className="mt-6 w-full"
        onClick={() => navigate("/find-my-gallery")}
        data-testid="button-find-my-gallery"
      >
        Find my gallery
      </Button>
      <Button
        variant="ghost"
        className="mt-3"
        onClick={() => navigate("/couple")}
        data-testid="button-return-home"
      >
        Back to couples
      </Button>
    </FormLayout>
  );
}
function GalleryUnavailable({ session }: { session: SessionDetailResponse }) {
  const [, navigate] = useLocation();
  return (
    <FormLayout
      label="A fresh perspective"
      title="Start a new possibility."
      description="Your venue is the beginning of your wedding vision."
    >
      <h2>This gallery needs a fresh start</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Return to your venue to create a new gallery with the current
        experience.
      </p>
      {session.venue?.slug && (
        <Button
          className="mt-6"
          onClick={() => navigate("/preview/" + session.venue?.slug)}
          data-testid="legacy-start-gallery"
        >
          Create gallery
        </Button>
      )}
      <Button
        variant="ghost"
        className="mt-3"
        onClick={() => navigate("/find-my-gallery")}
        data-testid="legacy-find-gallery"
      >
        Find my gallery
      </Button>
    </FormLayout>
  );
}
function FailureView({
  message,
  onRestart,
}: {
  message: string;
  onRestart: () => void;
}) {
  const [, navigate] = useLocation();
  return (
    <FormLayout
      label="Let’s try that again"
      title="A pause in the picture."
      description="Your wedding vision couldn’t be completed this time."
    >
      <h2>We couldn’t finish your gallery</h2>
      <p role="alert" className="text-sm text-muted-foreground leading-relaxed">
        {message}
      </p>
      <Button
        className="mt-6"
        onClick={onRestart}
        data-testid="failed-try-again"
      >
        <RotateCcw />
        Try again
      </Button>
      <Button
        variant="ghost"
        className="mt-3"
        onClick={() => navigate("/couple")}
        data-testid="failed-home"
      >
        Back to couples
      </Button>
    </FormLayout>
  );
}

function ProcessingView({ session }: { session: SessionDetailResponse }) {
  return (
    <div className="site-page">
      <SiteHeader />
      <main
        id="main-content"
        className="form-layout page-width"
        data-testid="processing-screen"
      >
        <aside>
          <p className="eyebrow">Your vision is taking shape</p>
          <h1>A day worth imagining.</h1>
          <p>
            We’re creating your portraits at{" "}
            {session.venue?.name || "your venue"}, then preparing your motion
            reel.
          </p>
        </aside>
        <section className="form-content" role="status">
          <Loader2 className="animate-spin text-primary mb-6" />
          <h2>Creating your gallery</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This usually takes a few minutes. This page updates automatically
            when your gallery is ready.
          </p>
          <p className="caption">
            You can close this tab. Keep this link to return to your gallery.
          </p>
          <a href="/couple" className="text-link" data-testid="processing-home">
            Back to couples →
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function ShareActionsToolbar({ session }: { session: SessionDetailResponse }) {
  const { toast } = useToast();
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmail, setShowEmail] = useState(!session.hasCoupleEmail);
  const emailLocked = session.hasCoupleEmail;

  const handleCopy = async () => {
    const ok = await copyShareLink(session);
    toast({
      title: ok ? "Link copied" : "Could not copy",
      description: ok
        ? "Share link is on your clipboard."
        : "Try copying the URL from the address bar.",
      variant: ok ? "default" : "destructive",
    });
  };

  const handleShare = async () => {
    const result = await shareSession(session);
    if (result === "shared") {
      toast({
        title: "Shared",
        description: "Thanks for sharing your gallery.",
      });
    } else if (result === "copied") {
      toast({
        title: "Link copied",
        description: "Web Share is not available; link copied instead.",
      });
    }
  };

  const handleSendEmail = async () => {
    if (!session.shareToken) {
      toast({
        title: "Share token missing",
        description: "Cannot send email for a legacy session.",
        variant: "destructive",
      });
      return;
    }
    if (!emailLocked && !emailInput.trim()) {
      toast({
        title: "Enter an email",
        description: "We need an address to send the link to.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const res = await fetch(
        `/api/sessions/by-token/${encodeURIComponent(session.shareToken)}/send-email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailLocked ? {} : { email: emailInput.trim() }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast({
        title: data.sent ? "Email sent" : "Email not sent",
        description: data.sent
          ? "Check your inbox for the link to your gallery."
          : "We couldn't send the email right now. Copy your gallery link to keep it, and try again soon.",
        variant: data.sent ? "default" : "destructive",
      });
      if (data.sent) setShowEmail(false);
    } catch (err) {
      toast({
        title: "Could not send email",
        description: err instanceof Error ? err.message : "Try again later.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="share-toolbar"
    >
      <motion.div className="space-y-4">
        <motion.div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            data-testid="copy-link-button"
          >
            <Link className="h-4 w-4 mr-2 text-muted-foreground" />
            Copy Link
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            data-testid="share-button"
          >
            <Share2 className="h-4 w-4 mr-2 text-muted-foreground" />
            Share
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowEmail((value) => !value)}
            data-testid="email-toggle-button"
          >
            <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
            {emailLocked ? "Resend to me" : "Email me"}
          </Button>
        </motion.div>

        {showEmail && (
          <form
            className="space-y-3 pt-2 border-t border-border"
            onSubmit={(event) => {
              event.preventDefault();
              handleSendEmail();
            }}
          >
            {emailLocked ? (
              <p className="text-sm text-muted-foreground text-center font-light">
                We will send the link to the email you provided when you created
                your gallery.
              </p>
            ) : (
              <>
                <label htmlFor="share-email">Email address</label>
                <input
                  id="share-email"
                  type="email"
                  required
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full rounded-md bg-secondary border border-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-brand transition-colors"
                  data-testid="email-input"
                  aria-label="Email address for your gallery"
                />
              </>
            )}
            <div className="flex justify-center">
              <Button
                type="submit"
                size="sm"
                disabled={sending || (!emailLocked && !emailInput.trim())}
                variant="brand"
                className="w-full sm:w-auto min-w-[120px]"
                data-testid="send-email-button"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Send Gallery Link"
                )}
              </Button>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

interface GalleryVisionViewProps {
  session: SessionDetailResponse;
  reel: GeneratedAsset | null;
  stills: GeneratedAsset[];
  onRestart: () => void;
}

function GalleryVisionView({
  session,
  reel,
  stills,
  onRestart,
}: GalleryVisionViewProps) {
  const [activeStill, setActiveStill] = useState(0);
  const activeAsset = stills[activeStill] ?? stills[0]!;
  const src = storageAssetUrl(activeAsset.objectKey, session.shareToken);
  const reelSrc = reel
    ? storageAssetUrl(reel.objectKey, session.shareToken)
    : null;
  const contact = venueContactAction(session.venue);
  return (
    <div className="site-page" data-testid="gallery-view">
      <SiteHeader />
      <main id="main-content" className="gallery-layout page-width">
        <section aria-label="Your wedding portraits">
          <img
            src={src}
            alt={"Wedding portrait " + (activeStill + 1)}
            className="gallery-main-image"
            data-testid="gallery-still-hero"
          />
          <div className="gallery-thumbnails">
            {stills.map((still, i) => (
              <button
                key={still.id}
                onClick={() => setActiveStill(i)}
                aria-pressed={activeStill === i}
                aria-label={"View portrait " + (i + 1)}
                data-testid={"gallery-still-" + i}
              >
                <img
                  src={storageAssetUrl(still.objectKey, session.shareToken)}
                  alt={"Portrait " + (i + 1)}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mt-4 gap-4">
            <p className="caption">
              Portrait {activeStill + 1} of {stills.length} · AI-generated
              vision
            </p>
            <a
              href={src}
              download
              className="text-link"
              data-testid={"gallery-still-download-" + activeStill}
            >
              <Download size={16} /> Save portrait
            </a>
          </div>
        </section>
        <aside className="gallery-sidebar">
          <p className="eyebrow">A glimpse of your day</p>
          <h1>{session.coupleName || "The two of you."}</h1>
          <p>
            Imagined at {session.venue?.name || "your venue"}. A little closer
            to the day you’ve been dreaming of.
          </p>
          <ShareActionsToolbar session={session} />
          {reelSrc && (
            <section className="mt-6">
              <h2 className="text-lg">Your day, in motion</h2>
              <video
                src={reelSrc}
                controls
                playsInline
                preload="metadata"
                data-testid="gallery-reel"
              />
              <a
                href={reelSrc}
                download
                className="text-link"
                data-testid="gallery-download-reel"
              >
                <Download size={16} /> Save motion reel
              </a>
            </section>
          )}
          {contact && (
            <div className="gallery-contact">
              <h2 className="text-xl mb-3">Make this possibility yours.</h2>
              <a
                href={contact.href}
                target="_blank"
                rel="noreferrer"
                className="action-primary"
                data-testid="venue-contact-cta"
              >
                <VenueContactIcon icon={contact.icon} />
                {contact.label}
                <ExternalLink size={16} />
              </a>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={onRestart}
            className="mt-6"
            data-testid="gallery-restart"
          >
            <RotateCcw /> Create another vision
          </Button>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}

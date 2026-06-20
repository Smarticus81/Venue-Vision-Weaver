import { useEffect, useRef, useState } from "react";
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
  AlertCircle,
  CalendarCheck,
  Download,
  ExternalLink,
  Globe,
  Home,
  ImageIcon,
  Images,
  Link,
  Loader2,
  Mail,
  Phone,
  RotateCcw,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";

function storageAssetUrl(objectKey: string, shareToken?: string | null): string {
  const token = shareToken ? `?shareToken=${encodeURIComponent(shareToken)}` : "";
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
    return { href: `tel:${venue.contactPhone.replace(/[^\d+]/g, "")}`, label: "Call venue", icon: "phone" };
  }
  return null;
}

function VenueContactIcon({ icon }: { icon: "calendar" | "globe" | "mail" | "phone" }) {
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (tokenQuery.isError || !session) return <NotAvailable />;

  const venueSlug = session.venue?.slug ?? "";
  const onRestart = () => setLocation(venueSlug ? `/preview/${venueSlug}` : "/couple");
  const stills = sortedGalleryStills(session);
  const reel = motionReel(session);

  const status = session.status as string;

  if (status === "pending" || status === "processing") {
    return <ProcessingView session={session} />;
  }

  if (status === "failed" && stills.length === 0) {
    return (
      <FailureView
        session={session}
        onRestart={onRestart}
        message={session.errorMessage ?? "We couldn't finish this gallery. Please try once more."}
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
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-6" />
      <h1 className="serif text-3xl md:text-4xl mb-3">This gallery isn't here</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        The link may be incorrect or expired. Use the email we sent you, or find your
        gallery with the address you used at the venue.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          onClick={() => setLocation("/find-my-gallery")}
          className="bg-primary text-primary-foreground min-h-[48px]"
          data-testid="button-find-my-gallery"
        >
          <Images className="mr-2 h-4 w-4" /> Find my gallery
        </Button>
        <Button
          onClick={() => setLocation("/couple")}
          variant="outline"
          className="min-h-[48px]"
          data-testid="button-return-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>
    </div>
  );
}

function GalleryUnavailable({ session }: { session: SessionDetailResponse }) {
  const [, setLocation] = useLocation();
  const venueSlug = session.venue?.slug ?? "";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="h-12 w-12 text-primary mb-6" />
      <h1 className="serif text-3xl md:text-4xl mb-3">This gallery needs a fresh start</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        glimpse now creates venue-branded galleries only. Start again from the venue
        page so we can use the current likeness and venue-preservation flow.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {venueSlug && (
          <Button
            onClick={() => setLocation(`/preview/${venueSlug}`)}
            className="bg-primary text-primary-foreground min-h-[48px]"
            data-testid="legacy-start-gallery"
          >
            <Images className="mr-2 h-4 w-4" /> Create gallery
          </Button>
        )}
        <Button
          onClick={() => setLocation("/find-my-gallery")}
          variant="outline"
          className="min-h-[48px]"
          data-testid="legacy-find-gallery"
        >
          <Mail className="mr-2 h-4 w-4" /> Find my gallery
        </Button>
      </div>
    </div>
  );
}

function FailureView({
  session,
  message,
  onRestart,
}: {
  session: SessionDetailResponse;
  message: string;
  onRestart: () => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-6" />
      <h2 className="serif text-3xl mb-4">glimpse paused</h2>
      <p className="text-muted-foreground mb-8 max-w-md">{message}</p>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
        <Button
          onClick={onRestart}
          className="flex-1 bg-primary text-primary-foreground"
          data-testid="failed-try-again"
        >
          <RotateCcw className="mr-2 h-4 w-4" /> Once more
        </Button>
        <Button
          variant="outline"
          onClick={() => setLocation(session.venue?.slug ? `/preview/${session.venue.slug}` : "/couple")}
          className="flex-1"
          data-testid="failed-home"
        >
          <Home className="mr-2 h-4 w-4" /> Venue page
        </Button>
      </div>
    </div>
  );
}

function ProcessingView({ session }: { session: SessionDetailResponse }) {
  const [, setLocation] = useLocation();
  const startedAt = session.createdAt ? new Date(session.createdAt).getTime() : Date.now();
  const elapsedMs = Date.now() - startedAt;
  const expectedMs = 60_000 * 4 + 30_000;
  const timeProgress = Math.min(elapsedMs / expectedMs, 1);
  const percent = Math.min(95, Math.max(8, Math.round(timeProgress * 95)));

  const phase =
    percent > 72
      ? "Preparing your motion reel"
      : percent > 38
        ? "Composing your venue portraits"
        : "Studying your venue and likeness references";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center relative"
      data-testid="processing-screen"
    >
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-muted-foreground hover:text-foreground"
          data-testid="processing-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
        {session.venue?.slug && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation(`/preview/${session.venue?.slug ?? ""}`)}
            className="text-muted-foreground hover:text-foreground"
            data-testid="processing-back-to-venue"
          >
            Back to venue
          </Button>
        )}
      </div>

      <div className="relative h-48 w-48 md:h-64 md:w-64 mb-10 flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.2, 1], rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-full border-t-2 border-primary/40 border-r-2 border-transparent"
        />
        <motion.div
          animate={{ scale: [1.2, 1, 1.2], rotate: -360 }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          className="absolute inset-4 rounded-full border-b-2 border-secondary/40 border-l-2 border-transparent"
        />
        <div className="z-10 bg-background/50 backdrop-blur-xl p-6 md:p-8 rounded-full border border-border">
          <Images className="h-10 w-10 md:h-12 md:w-12 text-primary animate-pulse" />
        </div>
      </div>

      <h2 className="serif text-2xl md:text-3xl mb-3 italic" data-testid="text-phase">
        {phase}
      </h2>
      <p className="text-muted-foreground font-light max-w-md mb-8" data-testid="text-phase-detail">
        We're rendering each portrait from your couple and venue photos, then stitching
        a gentle motion reel. This is usually ready in a few minutes.
      </p>

      <div className="w-full max-w-md mb-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span className="uppercase tracking-[0.2em] text-primary">glimpse</span>
          <span data-testid="text-progress-percent">{percent}%</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-primary to-secondary"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            data-testid="progress-bar"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground/70 max-w-md mt-6">
        Bookmark this page. It is how you will find your gallery again, and we will
        keep working if you close the tab.
      </p>
    </motion.div>
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
      toast({ title: "Shared", description: "Thanks for sharing your gallery." });
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
          : "Email service is not configured on this server.",
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 left-6 right-6 z-30 pointer-events-none"
    >
      <motion.div className="max-w-lg mx-auto pointer-events-auto bg-black/50 backdrop-blur-md rounded-2xl p-4 border border-white/10 space-y-3">
        <motion.div className="flex flex-wrap gap-2 justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            className="bg-white/10 text-white hover:bg-white/20 border-0"
            data-testid="copy-link-button"
          >
            <Link className="h-4 w-4 mr-2" />
            Copy Link
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleShare}
            className="bg-white/10 text-white hover:bg-white/20 border-0"
            data-testid="share-button"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowEmail((value) => !value)}
            className="bg-white/10 text-white hover:bg-white/20 border-0"
            data-testid="email-toggle-button"
          >
            <Mail className="h-4 w-4 mr-2" />
            {emailLocked ? "Resend to me" : "Email me"}
          </Button>
        </motion.div>
        {showEmail && (
          <div className="space-y-2">
            {emailLocked ? (
              <p className="text-xs text-white/70 text-center">
                We will send the link to the email you provided when you created your
                gallery.
              </p>
            ) : (
              <input
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg bg-black/40 border border-white/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary"
                data-testid="email-input"
              />
            )}
            <div className="flex justify-center">
              <Button
                size="sm"
                onClick={handleSendEmail}
                disabled={sending || (!emailLocked && !emailInput.trim())}
                className="bg-primary text-primary-foreground"
                data-testid="send-email-button"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
              </Button>
            </div>
          </div>
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

function GalleryVisionView({ session, reel, stills, onRestart }: GalleryVisionViewProps) {
  const [, setLocation] = useLocation();
  const [activeStill, setActiveStill] = useState(0);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reelSrc = reel ? storageAssetUrl(reel.objectKey, session.shareToken) : null;
  const venueName = session.venue?.name ?? "this venue";
  const contactAction = venueContactAction(session.venue);

  useEffect(() => {
    if (!videoRef.current || !reelSrc) return;
    videoRef.current.play().catch(() => undefined);
  }, [reelSrc]);

  const activeAsset = stills[activeStill] ?? stills[0]!;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-black text-white"
      data-testid="gallery-view"
    >
      {reelSrc ? (
        <div className="relative w-full min-h-[72vh] bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            src={reelSrc}
            autoPlay
            playsInline
            muted={muted}
            loop
            controls
            preload="auto"
            className="w-full max-h-[82vh] object-contain bg-black"
            data-testid="gallery-reel"
          />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black via-transparent to-black/50" />
          <div className="absolute top-6 left-6 right-6 flex justify-between gap-4 pointer-events-none">
            <div className="pointer-events-auto">
              <p className="text-xs uppercase tracking-[0.25em] text-white/60 mb-1">
                Created for {venueName}
              </p>
              <h2 className="serif text-2xl md:text-3xl font-semibold">
                {session.coupleName ? `${session.coupleName}` : "Your Wedding Vision"}
              </h2>
            </div>
            <div className="flex gap-2 pointer-events-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMuted((value) => !value)}
                className="text-white hover:bg-white/10 bg-black/30 backdrop-blur"
                data-testid="gallery-mute"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.open(reelSrc, "_blank")}
                className="text-white hover:bg-white/10 bg-black/30 backdrop-blur"
                data-testid="gallery-download-reel"
                title="Download reel"
              >
                <Download className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onRestart}
                className="text-white hover:bg-white/10 bg-black/30 backdrop-blur"
                data-testid="gallery-restart"
                title="Create another"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/couple")}
                className="text-white hover:bg-white/10 bg-black/30 backdrop-blur"
                title="Home"
              >
                <Home className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative w-full px-4 md:px-8 pt-8 pb-4 bg-gradient-to-b from-zinc-950 to-black">
          <div className="max-w-6xl mx-auto flex justify-between items-start gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-white/60 mb-1">
                Created for {venueName}
              </p>
              <h2 className="serif text-2xl md:text-3xl font-semibold">
                {session.coupleName ? `${session.coupleName}` : "Your Wedding Vision"}
              </h2>
            </div>
            <Button variant="outline" size="sm" onClick={onRestart} className="border-white/20">
              Create another
            </Button>
          </div>
        </div>
      )}

      <div className="relative bg-gradient-to-b from-black via-zinc-950 to-zinc-900 px-4 md:px-8 pt-8 pb-32">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <ImageIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm uppercase tracking-widest text-white/70">Editorial Stills</h3>
          </div>
          <p className="text-sm text-white/50 font-light mb-6 max-w-2xl">
            Four venue-anchored portraits. Download any frame or share the motion reel above.
          </p>

          {contactAction && (
            <div className="mb-8 rounded-lg border border-primary/30 bg-primary/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary mb-1">
                  Created for {venueName}
                </p>
                <p className="serif text-2xl leading-tight">
                  Picture the day here? Take the next step with the venue.
                </p>
              </div>
              <Button
                asChild
                className="bg-primary text-primary-foreground shrink-0"
                data-testid="venue-contact-cta"
              >
                <a href={contactAction.href} target="_blank" rel="noreferrer">
                  <VenueContactIcon icon={contactAction.icon} />
                  {contactAction.label}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stills.map((still, index) => {
              const src = storageAssetUrl(still.objectKey, session.shareToken);
              const selected = activeStill === index;
              return (
                <button
                  key={still.id}
                  type="button"
                  onClick={() => setActiveStill(index)}
                  className={`group relative rounded-xl overflow-hidden border transition-all text-left ${
                    selected ? "border-primary ring-2 ring-primary/40" : "border-white/10 hover:border-white/30"
                  }`}
                  data-testid={`gallery-still-${index}`}
                >
                  <img
                    src={src}
                    alt={`Portrait ${index + 1}`}
                    className="w-full aspect-[3/4] object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
                  <div className="absolute bottom-0 left-0 right-0 p-3 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-white/80">
                      Frame {index + 1}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(src, "_blank");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.stopPropagation();
                          window.open(src, "_blank");
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
                    >
                      <Download className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-8 rounded-2xl overflow-hidden border border-white/10 bg-black/40">
            <img
              src={storageAssetUrl(activeAsset.objectKey, session.shareToken)}
              alt="Selected portrait"
              className="w-full max-h-[70vh] object-contain mx-auto"
              data-testid="gallery-still-hero"
            />
          </div>
        </div>
      </div>

      <ShareActionsToolbar session={session} />
    </motion.div>
  );
}

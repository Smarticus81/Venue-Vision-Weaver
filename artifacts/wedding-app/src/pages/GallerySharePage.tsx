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
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

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
        <Loader2 className="h-12 w-12 animate-spin text-rose" />
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
      <AlertCircle className="h-12 w-12 text-muted-foreground mb-6" />
      <h1 className="font-display text-3xl md:text-4xl mb-3 text-foreground">This gallery isn't here</h1>
      <p className="text-muted-foreground max-w-md mb-8 font-light">
        The link may be incorrect or expired. Use the email we sent you, or find your
        gallery with the address you used at the venue.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          onClick={() => setLocation("/find-my-gallery")}
          variant="rose"
          className="min-h-[48px]"
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
      <AlertCircle className="h-12 w-12 text-rose mb-6" />
      <h1 className="font-display text-3xl md:text-4xl mb-3 text-foreground">This gallery needs a fresh start</h1>
      <p className="text-muted-foreground max-w-md mb-8 font-light">
        glimpse now creates venue-branded galleries only. Start again from the venue
        page so we can use the current likeness and venue-preservation flow.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {venueSlug && (
          <Button
            onClick={() => setLocation(`/preview/${venueSlug}`)}
            variant="rose"
            className="min-h-[48px]"
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
  message,
  onRestart,
}: {
  message: string;
  onRestart: () => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-6" />
      <h2 className="font-display text-3xl mb-4 text-foreground">glimpse paused</h2>
      <p className="text-muted-foreground mb-8 max-w-md font-light">{message}</p>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
        <Button
          onClick={onRestart}
          variant="rose"
          className="flex-1"
          data-testid="failed-try-again"
        >
          <RotateCcw className="mr-2 h-4 w-4" /> Once more
        </Button>
        <Button
          variant="outline"
          onClick={() => setLocation("/couple")}
          className="flex-1"
          data-testid="failed-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
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
          className="absolute inset-0 rounded-full border-t-2 border-rose/40 border-r-2 border-transparent"
        />
        <motion.div
          animate={{ scale: [1.2, 1, 1.2], rotate: -360 }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          className="absolute inset-4 rounded-full border-b-2 border-muted-foreground/20 border-l-2 border-transparent"
        />
        <div className="z-10 bg-card/80 backdrop-blur-xl p-6 md:p-8 rounded-full border border-card-border shadow-sm">
          <Images className="h-10 w-10 md:h-12 md:w-12 text-rose animate-pulse" />
        </div>
      </div>

      <h2 className="font-display text-2xl md:text-3xl mb-3 italic text-foreground" data-testid="text-phase">
        {phase}
      </h2>
      <p className="text-muted-foreground font-light max-w-md mb-8" data-testid="text-phase-detail">
        We're rendering each portrait from your couple and venue photos, then stitching
        a gentle motion reel. This is usually ready in a few minutes.
      </p>

      <div className="w-full max-w-md mb-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span className="uppercase tracking-[0.2em] text-rose font-semibold">glimpse</span>
          <span data-testid="text-progress-percent" className="font-medium text-foreground">{percent}%</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-md overflow-hidden">
          <motion.div
            className="h-full bg-rose"
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 left-6 right-6 z-30 pointer-events-none"
    >
      <motion.div className="max-w-xl mx-auto pointer-events-auto bg-card/95 backdrop-blur-md rounded-xl p-4 shadow-xl shadow-black/40 border border-card-border space-y-4">
        <motion.div className="flex flex-wrap gap-3 justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            data-testid="copy-link-button"
          >
            <Link className="h-4 w-4 mr-2 text-muted-foreground" />
            Copy Link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            data-testid="share-button"
          >
            <Share2 className="h-4 w-4 mr-2 text-muted-foreground" />
            Share
          </Button>
          <Button
            variant="outline"
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
                We will send the link to the email you provided when you created your
                gallery.
              </p>
            ) : (
              <input
                type="email"
                required
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-xl bg-secondary border border-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-rose transition-all"
                data-testid="email-input"
              />
            )}
            <div className="flex justify-center">
              <Button
                type="submit"
                size="sm"
                disabled={sending || (!emailLocked && !emailInput.trim())}
                variant="rose"
                className="w-full sm:w-auto min-w-[120px]"
                data-testid="send-email-button"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Gallery Link"}
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
      className="min-h-screen bg-background text-foreground"
      data-testid="gallery-view"
    >
      <header className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
           <div className="pointer-events-auto">
             <GlimpseLogo variant="mark" href="/" className="h-8 w-auto opacity-90 drop-shadow-md" />
           </div>
           
           <div className="flex gap-2 pointer-events-auto">
              {reelSrc && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMuted((value) => !value)}
                  className="bg-card/80 backdrop-blur text-foreground hover:bg-card border border-card-border shadow-sm"
                  data-testid="gallery-mute"
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </Button>
              )}
              {reelSrc && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="bg-card/80 backdrop-blur text-foreground hover:bg-card border border-card-border shadow-sm"
                  data-testid="gallery-download-reel"
                  title="Download reel"
                >
                  <a href={reelSrc} download aria-label="Download reel">
                    <Download className="h-5 w-5" />
                  </a>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onRestart}
                className="bg-card/80 backdrop-blur text-foreground hover:bg-card border border-card-border shadow-sm"
                data-testid="gallery-restart"
                title="Create another"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation("/couple")}
                className="bg-card/80 backdrop-blur text-foreground hover:bg-card border border-card-border shadow-sm"
                title="Home"
              >
                <Home className="h-5 w-5" />
              </Button>
            </div>
        </div>
      </header>

      {reelSrc ? (
        <div className="relative w-full min-h-[85vh] bg-black flex flex-col items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            src={reelSrc}
            autoPlay
            playsInline
            muted={muted}
            loop
            controls
            preload="auto"
            className="w-full h-full max-h-[85vh] object-contain md:object-cover opacity-90"
            data-testid="gallery-reel"
          />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black via-transparent to-black/30" />
          
          <div className="absolute bottom-16 left-6 right-6 md:bottom-24 max-w-7xl mx-auto flex flex-col items-center text-center pointer-events-none">
             <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/20 backdrop-blur-md px-4 py-1.5 text-xs font-semibold tracking-widest text-white/90 uppercase mb-6">
                Created for {venueName}
             </div>
             <h2 className="font-display text-4xl md:text-6xl lg:text-7xl font-semibold text-white drop-shadow-lg leading-tight max-w-4xl">
               {session.coupleName ? `${session.coupleName}` : "Your Wedding Vision"}
             </h2>
          </div>
        </div>
      ) : (
        <div className="relative w-full pt-32 pb-16 bg-card border-b border-border">
          <div className="max-w-5xl mx-auto px-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-4 py-1.5 text-xs font-semibold tracking-widest text-rose uppercase mb-6">
              Created for {venueName}
            </div>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground leading-tight mb-8">
              {session.coupleName ? `${session.coupleName}` : "Your Wedding Vision"}
            </h2>
          </div>
        </div>
      )}

      <div className="relative bg-background px-6 py-20 pb-40">
        <div className="max-w-5xl mx-auto">
          
          {contactAction && (
            <div className="mb-16 -mt-32 md:-mt-40 relative z-10 rounded-xl border border-card-border bg-card p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-black/40">
              <div className="text-center md:text-left max-w-xl">
                <p className="text-xs uppercase tracking-widest text-rose mb-3 font-semibold">
                  Take the next step
                </p>
                <h3 className="font-display text-3xl md:text-4xl leading-tight text-foreground">
                  Picture your day here? Let's make it a reality.
                </h3>
              </div>
              <Button
                asChild
                variant="rose"
                size="lg"
                className="w-full md:w-auto shrink-0 py-7 text-lg px-8"
                data-testid="venue-contact-cta"
              >
                <a href={contactAction.href} target="_blank" rel="noreferrer">
                  <VenueContactIcon icon={contactAction.icon} />
                  {contactAction.label}
                  <ExternalLink className="h-5 w-5 ml-2" />
                </a>
              </Button>
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10 mt-12">
             <div className="max-w-xl">
                <div className="flex items-center gap-2 mb-4">
                  <ImageIcon className="h-5 w-5 text-rose" />
                  <h3 className="text-sm font-semibold tracking-widest uppercase text-rose">Editorial Stills</h3>
                </div>
                <p className="text-lg text-muted-foreground font-light leading-relaxed">
                  Four venue-anchored portraits. Tap any frame to enlarge, or download to keep.
                </p>
             </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12">
            {stills.map((still, index) => {
              const src = storageAssetUrl(still.objectKey, session.shareToken);
              const selected = activeStill === index;
              return (
                <div
                  key={still.id}
                  className={`group relative rounded-xl overflow-hidden border transition-all ${
                    selected ? "border-rose ring-2 ring-rose/40 ring-offset-2 ring-offset-background" : "border-card-border hover:border-rose/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveStill(index)}
                    aria-label={`View portrait ${index + 1}`}
                    className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`gallery-still-${index}`}
                  >
                    <div className="aspect-[3/4] w-full overflow-hidden bg-card">
                      <img
                        src={src}
                        alt={`Portrait ${index + 1}`}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    </div>
                  </button>
                  <div
                    className={`absolute inset-x-0 bottom-0 p-4 flex items-center justify-between pointer-events-none bg-gradient-to-t from-black/60 via-black/20 to-transparent transition-opacity duration-300 ${
                      selected
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    }`}
                  >
                    <span className="text-xs font-medium uppercase tracking-wider text-white">
                      Frame {index + 1}
                    </span>
                    <a
                      href={src}
                      download
                      aria-label={`Download portrait ${index + 1}`}
                      data-testid={`gallery-still-download-${index}`}
                      className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl overflow-hidden border border-card-border bg-card shadow-2xl shadow-black/40 p-4 md:p-8">
            <img
              src={storageAssetUrl(activeAsset.objectKey, session.shareToken)}
              alt="Selected portrait"
              className="w-full max-h-[75vh] object-contain mx-auto rounded-xl shadow-md"
              data-testid="gallery-still-hero"
            />
          </div>
        </div>
      </div>

      <ShareActionsToolbar session={session} />
    </motion.div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  getGetSessionByTokenQueryKey,
  useGetSessionByToken,
  type GeneratedAsset,
  type SessionDetailResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { copyShareLink, shareSession } from "@/lib/shareSession";
import {
  AlertCircle,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Images,
  Link,
  Loader2,
  Mail,
  Phone,
  Play,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { cn } from "@/lib/utils";

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
    session.generatedAssets?.find((asset) => asset.assetType === "video" && asset.displayOrder === 0) ?? null
  );
}

type ContactAction = { href: string; label: string; icon: "calendar" | "globe" | "mail" | "phone" };

function venueContactAction(venue: SessionDetailResponse["venue"]): ContactAction | null {
  if (!venue) return null;
  if (venue.bookingUrl) return { href: venue.bookingUrl, label: "Book a tour", icon: "calendar" };
  if (venue.websiteUrl) return { href: venue.websiteUrl, label: `Visit ${venue.name}`, icon: "globe" };
  if (venue.contactEmail) {
    return {
      href: `mailto:${venue.contactEmail}?subject=${encodeURIComponent(`Our glimpse gallery at ${venue.name}`)}`,
      label: `Email ${venue.name}`,
      icon: "mail",
    };
  }
  if (venue.contactPhone) {
    return { href: `tel:${venue.contactPhone.replace(/[^\d+]/g, "")}`, label: `Call ${venue.name}`, icon: "phone" };
  }
  return null;
}

function ContactIcon({ icon }: { icon: ContactAction["icon"] }) {
  if (icon === "calendar") return <CalendarCheck className="h-4 w-4" />;
  if (icon === "globe") return <Globe className="h-4 w-4" />;
  if (icon === "phone") return <Phone className="h-4 w-4" />;
  return <Mail className="h-4 w-4" />;
}

export default function GallerySharePage() {
  const { shareToken } = useParams<{ shareToken: string }>();

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background" aria-busy="true">
        <Loader2 className="h-10 w-10 animate-spin text-rose" />
        <p className="mono-label text-muted-foreground">Opening your gallery…</p>
      </div>
    );
  }

  if (tokenQuery.isError || !session) return <NotAvailable />;

  const stills = sortedGalleryStills(session);
  const reel = motionReel(session);
  const status = session.status as string;

  if (status === "pending" || status === "processing") return <ProcessingView session={session} />;

  if (status === "failed" && stills.length === 0) {
    return (
      <FailureView
        session={session}
        message={session.errorMessage ?? "We couldn't finish this gallery. Please try once more."}
      />
    );
  }

  if (stills.length > 0) return <GalleryView session={session} reel={reel} stills={stills} />;

  return <GalleryUnavailable session={session} />;
}

/* ————————————————— shared frame for the small states ————————————————— */

function StatePage({
  eyebrow,
  title,
  children,
  icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="grain relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/couple" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        {icon}
        <p className="mono-label mb-4 text-rose">{eyebrow}</p>
        <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">{title}</h1>
        <div className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{children}</div>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">{actions}</div>
      </main>
    </div>
  );
}

function NotAvailable() {
  const [, setLocation] = useLocation();
  return (
    <StatePage
      eyebrow="Gallery link"
      title="This gallery isn't here"
      icon={<AlertCircle className="mb-6 h-10 w-10 text-muted-foreground" />}
      actions={
        <>
          <Button onClick={() => setLocation("/find-my-gallery")} variant="rose" className="h-12 px-6" data-testid="button-find-my-gallery">
            <Images className="h-4 w-4" /> Find my gallery
          </Button>
          <Button onClick={() => setLocation("/couple")} variant="ghost" className="h-12 px-6 text-muted-foreground hover:text-foreground" data-testid="button-return-home">
            Start over
          </Button>
        </>
      }
    >
      The link may be mistyped or expired. Open the email we sent you, or find your gallery with the address you used
      at the venue.
    </StatePage>
  );
}

function GalleryUnavailable({ session }: { session: SessionDetailResponse }) {
  const [, setLocation] = useLocation();
  const venueSlug = session.venue?.slug ?? "";
  return (
    <StatePage
      eyebrow="Start again"
      title="This gallery needs a fresh start"
      icon={<AlertCircle className="mb-6 h-10 w-10 text-rose" />}
      actions={
        <>
          {venueSlug && (
            <Button onClick={() => setLocation(`/preview/${venueSlug}`)} variant="rose" className="h-12 px-6" data-testid="legacy-start-gallery">
              <Images className="h-4 w-4" /> Create a new gallery
            </Button>
          )}
          <Button onClick={() => setLocation("/find-my-gallery")} variant="ghost" className="h-12 px-6 text-muted-foreground hover:text-foreground" data-testid="legacy-find-gallery">
            Find my gallery
          </Button>
        </>
      }
    >
      This one was made with an older version of glimpse. Start again from the venue page and we'll render it with
      the current likeness and venue checks.
    </StatePage>
  );
}

function FailureView({ session, message }: { session: SessionDetailResponse; message: string }) {
  const [, setLocation] = useLocation();
  const venueSlug = session.venue?.slug ?? "";
  return (
    <StatePage
      eyebrow="Didn't develop"
      title="We couldn't finish your gallery"
      icon={<AlertCircle className="mb-6 h-10 w-10 text-destructive" />}
      actions={
        <>
          <Button onClick={() => setLocation(venueSlug ? `/preview/${venueSlug}` : "/couple")} variant="rose" className="h-12 px-6" data-testid="failed-try-again">
            Try again with new photos
          </Button>
        </>
      }
    >
      {message}
    </StatePage>
  );
}

function ProcessingView({ session }: { session: SessionDetailResponse }) {
  const reduce = useReducedMotion();
  const startedAt = session.createdAt ? new Date(session.createdAt).getTime() : Date.now();
  const elapsedMs = Date.now() - startedAt;
  const expectedMs = 60_000 * 4 + 30_000;
  const timeProgress = Math.min(elapsedMs / expectedMs, 1);
  const percent = Math.min(95, Math.max(8, Math.round(timeProgress * 95)));
  const venueName = session.venue?.name ?? "the venue";

  const stage = percent > 72 ? 2 : percent > 38 ? 1 : 0;
  const stages = ["Studying your photos and the venue", "Composing four portraits", "Cutting the motion reel"];

  return (
    <div className="grain relative flex min-h-screen flex-col bg-background text-foreground" data-testid="processing-screen">
      <header className="flex h-16 items-center justify-between px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/couple" />
        <p className="mono-label hidden text-muted-foreground sm:block">Created for {venueName}</p>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="mono-label mb-4 text-rose">Developing</p>
        <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl" data-testid="text-phase">
          {session.coupleName ? `${session.coupleName}, your gallery is developing.` : "Your gallery is developing."}
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground" data-testid="text-phase-detail">
          Four portraits of you at {venueName}, then a short reel. Usually a few minutes.
        </p>

        <ol className="mt-10 w-full max-w-sm space-y-3 text-left" aria-label="Progress">
          {stages.map((label, i) => {
            const done = i < stage;
            const active = i === stage;
            return (
              <li key={label} className={cn("flex items-center gap-3 text-sm", done ? "text-muted-foreground" : active ? "text-foreground" : "text-muted-foreground/50")}>
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center border", done ? "border-emerald-400/60 text-emerald-300" : active ? "border-rose" : "border-border")} aria-hidden>
                  {done ? <Check className="h-3 w-3" /> : active ? <span className={cn("h-1.5 w-1.5 rounded-full bg-rose", !reduce && "animate-pulse")} /> : null}
                </span>
                {label}
                {active && <span className="sr-only"> (in progress)</span>}
              </li>
            );
          })}
        </ol>

        <div className="mt-8 w-full max-w-sm" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Gallery progress">
          <div className="h-px w-full bg-border">
            <motion.div className="h-full bg-rose" initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }} data-testid="progress-bar" />
          </div>
          <p className="mono-label mt-2 text-right text-muted-foreground" data-testid="text-progress-percent">{percent}%</p>
        </div>

        <p className="mt-8 max-w-sm text-xs leading-relaxed text-muted-foreground/80">
          This page is your gallery's home. Keep the link — we keep working if you close the tab
          {session.hasCoupleEmail ? ", and we'll email you when it's ready." : "."}
        </p>
      </main>
    </div>
  );
}

/* ————————————————— the gallery ————————————————— */

function ShareActions({ session, compact = false }: { session: SessionDetailResponse; compact?: boolean }) {
  const { toast } = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const emailLocked = session.hasCoupleEmail;

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await copyShareLink(session);
    setCopied(ok);
    if (!ok) toast({ title: "Couldn't copy", description: "Copy the address from the address bar instead.", variant: "destructive" });
  };

  const handleShare = async () => {
    const result = await shareSession(session);
    if (result === "copied") {
      setCopied(true);
    }
  };

  const handleSendEmail = async () => {
    if (!session.shareToken) return;
    if (!emailLocked && !emailInput.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/sessions/by-token/${encodeURIComponent(session.shareToken)}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailLocked ? {} : { email: emailInput.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { sent?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast({
        title: data.sent ? "Link sent" : "Email not sent",
        description: data.sent ? "Check your inbox for your gallery link." : "Email isn't set up on this server.",
        variant: data.sent ? "default" : "destructive",
      });
      if (data.sent) setEmailOpen(false);
    } catch (err) {
      toast({ title: "Couldn't send", description: err instanceof Error ? err.message : "Try again later.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const item =
    "inline-flex h-10 items-center gap-2 px-3 text-sm text-foreground/80 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className={cn("flex flex-col", compact ? "items-start" : "items-start")}>
      <div className="-ml-3 flex flex-wrap items-center">
        <button type="button" onClick={handleCopy} className={item} data-testid="copy-link-button">
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Link className="h-4 w-4" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={handleShare} className={item} data-testid="share-button">
          <Share2 className="h-4 w-4" /> Share
        </button>
        <button
          type="button"
          onClick={() => setEmailOpen((v) => !v)}
          aria-expanded={emailOpen}
          aria-controls="share-email-form"
          className={item}
          data-testid="email-toggle-button"
        >
          <Mail className="h-4 w-4" /> {emailLocked ? "Email it to me again" : "Email me the link"}
        </button>
      </div>
      {emailOpen && (
        <form
          id="share-email-form"
          className="mt-3 flex w-full max-w-md flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendEmail();
          }}
        >
          {emailLocked ? (
            <p className="flex-1 self-center text-sm text-muted-foreground">We'll resend it to the address you gave at the venue.</p>
          ) : (
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              aria-label="Your email"
              className="h-11 flex-1 border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-rose focus:outline-none focus:ring-2 focus:ring-ring/50"
              data-testid="email-input"
            />
          )}
          <Button type="submit" variant="rose" disabled={sending || (!emailLocked && !emailInput.trim())} className="h-11 px-5" data-testid="send-email-button">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {emailLocked ? "Resend" : "Send link"}
          </Button>
        </form>
      )}
    </div>
  );
}

function GalleryView({ session, reel, stills }: { session: SessionDetailResponse; reel: GeneratedAsset | null; stills: GeneratedAsset[] }) {
  const [, setLocation] = useLocation();
  const [muted, setMuted] = useState(true);
  const [reelReady, setReelReady] = useState(false);
  const [reelPlaying, setReelPlaying] = useState(false);
  const [reelError, setReelError] = useState(false);
  const [reelLandscape, setReelLandscape] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const lightboxTrigger = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const attemptedAutoplayRef = useRef(false);
  const reelSrc = reel ? storageAssetUrl(reel.objectKey, session.shareToken) : null;
  const reelPoster = stills[0] ? storageAssetUrl(stills[0].objectKey, session.shareToken) : undefined;
  const venueName = session.venue?.name ?? "this venue";
  const venueSlug = session.venue?.slug ?? "";
  const contactAction = venueContactAction(session.venue);
  const title = session.coupleName ? session.coupleName : "Your wedding, here";

  useEffect(() => {
    attemptedAutoplayRef.current = false;
    setReelReady(false);
    setReelPlaying(false);
    setReelError(false);
    videoRef.current?.load();
  }, [reelSrc]);

  const playReel = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setReelPlaying(true);
    } catch {
      setReelPlaying(false);
    }
  };

  const handleReelCanPlay = () => {
    setReelReady(true);
    if (attemptedAutoplayRef.current) return;
    attemptedAutoplayRef.current = true;
    void playReel();
  };

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
      if (videoRef.current.paused) void playReel();
    }
  };

  const stillSrc = (i: number) => storageAssetUrl(stills[i]!.objectKey, session.shareToken);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen bg-background text-foreground" data-testid="gallery-view">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 md:h-20">
          <div className="pointer-events-auto">
            <GlimpseLogo variant="mark" href="/couple" className="opacity-90 drop-shadow-md" />
          </div>
          {reelSrc && !reelError && (
            <button
              type="button"
              onClick={handleMuteToggle}
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="gallery-mute"
              aria-label={muted ? "Unmute motion reel" : "Mute motion reel"}
              aria-pressed={!muted}
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          )}
        </div>
      </header>

      {/* Hero: the reel (or the first still) with the couple's names. */}
      <section className="relative isolate h-[100svh] min-h-[30rem] w-full overflow-hidden bg-black md:h-[85vh] md:min-h-[38rem]" aria-label="Motion reel">
        {reelSrc ? (
          <>
            {reelPoster && <img src={reelPoster} alt="" aria-hidden="true" className={cn("absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl md:hidden", reelLandscape && "hidden")} />}
            <video
              ref={videoRef}
              src={reelSrc}
              poster={reelPoster}
              autoPlay
              playsInline
              muted={muted}
              loop
              preload="metadata"
              aria-label={`Motion reel created for ${venueName}`}
              onCanPlay={handleReelCanPlay}
              onLoadedMetadata={(e) => setReelLandscape(e.currentTarget.videoWidth > e.currentTarget.videoHeight)}
              onPlaying={() => {
                setReelReady(true);
                setReelPlaying(true);
              }}
              onPause={() => setReelPlaying(false)}
              onWaiting={() => setReelReady(false)}
              onError={() => {
                setReelError(true);
                setReelReady(false);
                setReelPlaying(false);
              }}
              onClick={() => (videoRef.current?.paused ? void playReel() : videoRef.current?.pause())}
              className={cn("absolute inset-0 z-[1] h-full w-full md:object-cover", reelLandscape ? "object-cover" : "object-contain")}
              data-testid="gallery-reel"
            />
          </>
        ) : (
          reelPoster && <img src={reelPoster} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-background via-transparent to-black/40" />

        {reelSrc && !reelError && !reelReady && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex items-center gap-3 rounded-full bg-black/65 px-5 py-3 text-sm text-white backdrop-blur">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading the reel
            </div>
          </div>
        )}
        {reelSrc && !reelError && reelReady && !reelPlaying && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <button
              type="button"
              onClick={() => void playReel()}
              className="inline-flex h-14 items-center gap-2 rounded-full border border-white/40 bg-black/70 px-6 text-base text-white backdrop-blur transition-colors hover:bg-black/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="gallery-play-reel"
            >
              <Play className="h-5 w-5 fill-current" /> Play the reel
            </button>
          </div>
        )}
        {reelSrc && reelError && (
          <div className="absolute inset-x-0 top-24 z-10 flex justify-center px-6">
            <a className="rounded-full bg-black/70 px-5 py-2.5 text-sm text-white underline-offset-4 backdrop-blur hover:underline" href={reelSrc} target="_blank" rel="noreferrer">
              The reel can't play in this browser — open it directly
            </a>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 mx-auto max-w-7xl px-4 pb-10 sm:px-6 md:pb-14">
          <p className="mono-label text-white/80 [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">At {venueName}</p>
          <h1 className="mt-3 font-display text-4xl font-medium leading-[0.95] tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)] sm:text-6xl md:text-7xl">
            {title}
          </h1>
        </div>
      </section>

      {/* The venue's ask, then the couple's tools. */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6" aria-label="Next step">
        <div className="flex flex-col gap-6 border-b border-border py-8 md:flex-row md:items-center md:justify-between md:py-10">
          <div className="max-w-xl">
            <p className="font-display text-2xl leading-tight md:text-3xl">
              {contactAction ? "Picture your day here?" : `Made for you by ${venueName}.`}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {contactAction
                ? `${venueName} would love to show you the real thing.`
                : "Four portraits and a reel, rendered in the rooms you toured."}
            </p>
          </div>
          {contactAction && (
            <Button asChild variant="rose" className="h-14 w-full px-8 text-base md:w-auto" data-testid="venue-contact-cta">
              <a href={contactAction.href} target="_blank" rel="noreferrer">
                <ContactIcon icon={contactAction.icon} />
                {contactAction.label}
              </a>
            </Button>
          )}
        </div>
        <div className="py-5">
          <ShareActions session={session} />
        </div>
      </section>

      {/* Stills */}
      <section className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 md:pt-12" aria-labelledby="stills-title">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 id="stills-title" className="font-display text-2xl font-medium tracking-tight md:text-3xl">
            Four portraits
          </h2>
          <p className="mono-label text-muted-foreground">Tap to enlarge</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5" aria-label="Portraits">
          {stills.map((still, index) => (
            <li key={still.id} className="group relative">
              <button
                type="button"
                onClick={(e) => {
                  lightboxTrigger.current = e.currentTarget;
                  setLightbox(index);
                }}
                aria-label={`Open portrait ${index + 1} of ${stills.length}`}
                className="block w-full overflow-hidden border border-border bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`gallery-still-${index}`}
              >
                <img src={stillSrc(index)} alt={`Portrait ${index + 1} at ${venueName}`} loading={index > 1 ? "lazy" : "eager"} className="aspect-[3/4] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
              </button>
              <a
                href={stillSrc(index)}
                download
                aria-label={`Download portrait ${index + 1}`}
                data-testid={`gallery-still-download-${index}`}
                className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Download className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
        {reelSrc && (
          <div className="mt-6">
            <a href={reelSrc} download className="inline-flex h-10 items-center gap-2 text-sm text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="gallery-download-reel">
              <Download className="h-4 w-4" /> Download the reel
            </a>
          </div>
        )}
      </section>

      <footer className="border-t border-border bg-wine px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="mono-label text-muted-foreground">A glimpse of your day</p>
          {venueSlug && (
            <button type="button" onClick={() => setLocation(`/preview/${venueSlug}`)} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="gallery-restart">
              Make another gallery at {venueName}
            </button>
          )}
          <p className="mono-label text-muted-foreground/70">© {new Date().getFullYear()} glimpse</p>
        </div>
      </footer>

      <Lightbox
        open={lightbox !== null}
        index={lightbox ?? 0}
        count={stills.length}
        src={lightbox !== null ? stillSrc(lightbox) : ""}
        venueName={venueName}
        onClose={() => setLightbox(null)}
        returnFocusTo={lightboxTrigger}
        onStep={(d) => setLightbox((i) => (i === null ? 0 : (i + d + stills.length) % stills.length))}
      />
    </motion.div>
  );
}

function Lightbox({ open, index, count, src, venueName, onClose, onStep, returnFocusTo }: { open: boolean; index: number; count: number; src: string; venueName: string; onClose: () => void; onStep: (delta: 1 | -1) => void; returnFocusTo: React.MutableRefObject<HTMLElement | null> }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onStep(1);
      if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStep]);

  const navBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        variant="bare"
        hideClose
        className="h-[100svh] w-screen max-w-none"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">
          Portrait {index + 1} of {count} at {venueName}
        </DialogTitle>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
            <p className="mono-label text-white/80">
              {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
            </p>
            <div className="flex items-center gap-2">
              <a href={src} download aria-label="Download this portrait" className={navBtn}>
                <Download className="h-5 w-5" />
              </a>
              <button type="button" onClick={onClose} aria-label="Close" className={navBtn}>
                <span aria-hidden className="text-xl leading-none">×</span>
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-4 sm:px-16">
            <img src={src} alt={`Portrait ${index + 1} at ${venueName}`} className="max-h-full max-w-full object-contain" data-testid="gallery-still-hero" />
            {count > 1 && (
              <>
                <button type="button" onClick={() => onStep(-1)} aria-label="Previous portrait" className={cn(navBtn, "absolute left-3 top-1/2 -translate-y-1/2 sm:left-6")}>
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => onStep(1)} aria-label="Next portrait" className={cn(navBtn, "absolute right-3 top-1/2 -translate-y-1/2 sm:right-6")}>
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

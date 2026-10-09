import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  getGetSessionByTokenQueryKey,
  useGetSessionByToken,
  useSendSessionEmailByToken,
  type GeneratedAsset,
  type SessionDetailResponse,
  type VenuePublicResponse,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Link2,
  Loader2,
  Mail,
  RotateCcw,
  Share2,
} from "lucide-react";
import { CoupleChrome } from "@/components/layout/CoupleChrome";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  copyShareLink,
  createdGalleryRecord,
  dateCtaFor,
  formatWeddingMonth,
  postGalleryEvent,
  processingDeliveryNote,
  processingPollInterval,
  realSpaceFor,
  reelAsset,
  sceneTitle,
  sessionStore,
  shareAssetUrl,
  shareGallery,
  sortedStills,
  venueMediaUrl,
  type CreatorRecord,
  type DateCta,
  type GalleryEventType,
} from "@/lib/shareSession";

/** Past this, the processing view says so plainly instead of implying it is nearly done. */
const SLOW_GALLERY_MS = 10 * 60_000;

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

function elapsedSince(iso: string | null | undefined, now: number): number {
  const started = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(started) ? Math.max(0, now - started) : 0;
}

export default function GallerySharePage() {
  const { shareToken = "" } = useParams<{ shareToken: string }>();
  const creator = useMemo(() => createdGalleryRecord(sessionStore(), shareToken), [shareToken]);

  const tokenQuery = useGetSessionByToken(shareToken, {
    query: {
      queryKey: getGetSessionByTokenQueryKey(shareToken),
      enabled: !!shareToken,
      retry: (count, err) => errorStatus(err) !== 404 && count < 2,
      refetchOnWindowFocus: (query) => {
        const data = query.state.data;
        return data?.status === "pending" || data?.status === "processing" || data?.deliveryHeld === true;
      },
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return false;
        // Held for the venue's review: check back now and then until it is sent.
        if (data.status === "ready" && data.deliveryHeld) return HELD_POLL_MS;
        if (data.status !== "pending" && data.status !== "processing") return false;
        return processingPollInterval(elapsedSince(data.createdAt, Date.now()));
      },
    },
  });

  const session = tokenQuery.data;

  if (!shareToken) return <NotFoundView />;

  if (tokenQuery.isLoading) {
    return (
      <CoupleChrome venue={null}>
        <section className="cp-message" role="status">
          <Loader2 className="animate-spin text-brand" />
          <p className="eyebrow">Opening your gallery…</p>
        </section>
      </CoupleChrome>
    );
  }

  if (!session) {
    return errorStatus(tokenQuery.error) === 404 ? (
      <NotFoundView />
    ) : (
      <TransientErrorView onRetry={() => void tokenQuery.refetch()} retrying={tokenQuery.isFetching} />
    );
  }

  const status = session.status;
  const stills = sortedStills(session.generatedAssets);

  if (status === "pending" || status === "processing") {
    return <ProcessingView session={session} creator={creator} offline={tokenQuery.isError} />;
  }

  if (status === "ready" && session.deliveryHeld) {
    return <HeldView session={session} />;
  }

  if (stills.length > 0) {
    return <GalleryView session={session} stills={stills} creator={creator} />;
  }

  if (status === "failed") {
    return <FailureView session={session} creator={creator} />;
  }

  return <UnavailableView session={session} creator={creator} />;
}

/* ————— Error and edge states ————— */

function NotFoundView() {
  return (
    <CoupleChrome venue={null}>
      <section className="cp-message">
        <p className="eyebrow">Link not found</p>
        <h1>We couldn't find that gallery.</h1>
        <p>
          The link may be missing a few characters. Copy it again from your email, or have the links sent to you
          again.
        </p>
        <Link href="/find-my-gallery" className="cp-message__link" data-testid="button-find-my-gallery">
          Find my gallery <ArrowRight size={16} />
        </Link>
      </section>
    </CoupleChrome>
  );
}

function TransientErrorView({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <CoupleChrome venue={null}>
      <section className="cp-message">
        <p className="eyebrow">Connection</p>
        <h1>We couldn't open your gallery just now.</h1>
        <p>Your gallery is safe. Check your connection, then try again.</p>
        <Button className="cp-message__action" onClick={onRetry} disabled={retrying} data-testid="gallery-retry">
          {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />} Try again
        </Button>
      </section>
    </CoupleChrome>
  );
}

function FailureView({ session, creator }: { session: SessionDetailResponse; creator: CreatorRecord | null }) {
  const [, navigate] = useLocation();
  const venue = session.venue ?? null;
  return (
    <CoupleChrome venue={venue}>
      <section className="cp-message">
        <p className="eyebrow">Gallery</p>
        <h1>We couldn't finish this gallery.</h1>
        <p role="alert">{session.errorMessage ?? "Something went wrong while making it. Please try once more."}</p>
        {creator && venue ? (
          <Button
            className="cp-message__action"
            onClick={() => navigate(`/preview/${venue.slug}`)}
            data-testid="failed-try-again"
          >
            <RotateCcw /> Try again
          </Button>
        ) : null}
      </section>
    </CoupleChrome>
  );
}

const HELD_POLL_MS = 60_000;

/** Ready, but the venue looks at it first (review before send, or a frame the quality check could not judge). */
function HeldView({ session }: { session: SessionDetailResponse }) {
  const venue = session.venue ?? null;
  const venueName = venue?.name ?? "The venue";
  return (
    <CoupleChrome venue={venue}>
      <section className="cp-message" role="status" data-testid="held-screen">
        <p className="eyebrow">Almost there</p>
        <h1>Your gallery is made.</h1>
        <p>
          {venueName} takes a quick look before it goes out
          {session.hasCoupleEmail ? ", then it is emailed to you" : ""}. Keep this link: the gallery appears here as soon
          as it is sent.
        </p>
      </section>
    </CoupleChrome>
  );
}

function UnavailableView({ session, creator }: { session: SessionDetailResponse; creator: CreatorRecord | null }) {
  const [, navigate] = useLocation();
  const venue = session.venue ?? null;
  return (
    <CoupleChrome venue={venue}>
      <section className="cp-message">
        <p className="eyebrow">Gallery</p>
        <h1>This gallery can't be shown any more.</h1>
        <p>It was made with an older version of the preview.</p>
        {creator && venue ? (
          <Button
            className="cp-message__action"
            onClick={() => navigate(`/preview/${venue.slug}`)}
            data-testid="legacy-start-gallery"
          >
            Start a new one
          </Button>
        ) : null}
      </section>
    </CoupleChrome>
  );
}

/* ————— Processing ————— */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ProcessingView({
  session,
  creator,
  offline,
}: {
  session: SessionDetailResponse;
  creator: CreatorRecord | null;
  offline: boolean;
}) {
  const { toast } = useToast();
  const now = useNow(1000);
  const venue = session.venue ?? null;
  const venueName = venue?.name ?? "your venue";
  const elapsed = elapsedSince(session.createdAt, now);
  const slow = elapsed > SLOW_GALLERY_MS;
  const photos = (venue?.media ?? []).slice(0, 5);
  const activePhoto = photos.length > 0 ? Math.floor(now / 4000) % photos.length : 0;

  const copy = async () => {
    const ok = session.shareToken ? await copyShareLink(session.shareToken) : false;
    toast({
      title: ok ? "Link copied" : "Couldn't copy",
      description: ok ? "Paste it anywhere to come back to your gallery." : "Copy the address from your browser bar.",
    });
  };

  return (
    <CoupleChrome venue={venue} eyebrow="Making your gallery at">
      <section className="gs-wait" data-testid="processing-screen">
        <div className="gs-wait__stage" aria-hidden>
          {photos.map((photo, i) => (
            <img
              key={photo.id}
              src={venueMediaUrl(photo.objectKey, venue!.slug)}
              alt=""
              data-active={i === activePhoto}
              decoding="async"
            />
          ))}
          <span className="gs-wait__badge">
            <span className="gs-pulse" /> Imagining you here
          </span>
        </div>
        <div className="gs-wait__copy" role="status" aria-live="polite">
          <p className="eyebrow">Making your gallery</p>
          <h1>Placing the two of you in {venueName}.</h1>
          <p className="cp-lede">
            {slow
              ? "This one is taking longer than usual. It's still working; leave this page open or come back to this link later."
              : "Most galleries are ready in about five minutes. This page updates on its own."}
          </p>
          <p className="gs-wait__clock">
            <span>{formatElapsed(elapsed)}</span> so far
          </p>
          <ol className="gs-wait__steps">
            <li>We read your photos.</li>
            <li>We imagine four scenes in {venueName}'s real spaces.</li>
            <li>We check every image for likeness and the venue.</li>
            <li>We cut a short reel.</li>
          </ol>
          {offline ? (
            <p className="cp-note">We lost the connection for a moment. We'll keep checking.</p>
          ) : null}
          <div className="gs-wait__keep">
            <p>
              {processingDeliveryNote({
                email: creator?.email,
                venueName,
                reviewBeforeSend: venue?.reviewBeforeSend,
              })}
            </p>
            <button type="button" className="cp-textbutton" onClick={() => void copy()}>
              <Link2 size={15} /> Copy link
            </button>
          </div>
        </div>
      </section>
    </CoupleChrome>
  );
}

/* ————— The gallery ————— */

function DateCtaLink({
  cta,
  onClick,
  compact = false,
  testId,
}: {
  cta: DateCta;
  onClick: () => void;
  compact?: boolean;
  testId: string;
}) {
  return (
    <a
      href={cta.href}
      className={compact ? "gs-cta gs-cta--compact" : "gs-cta"}
      onClick={onClick}
      target={cta.external ? "_blank" : undefined}
      rel={cta.external ? "noopener" : undefined}
      data-testid={testId}
    >
      {compact ? cta.shortLabel : cta.label}
      <ArrowRight size={18} aria-hidden />
    </a>
  );
}

function GalleryView({
  session,
  stills,
  creator,
}: {
  session: SessionDetailResponse;
  stills: GeneratedAsset[];
  creator: CreatorRecord | null;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const venue: VenuePublicResponse | null = session.venue ?? null;
  const venueName = venue?.name ?? "your venue";
  const token = session.shareToken ?? "";
  const reel = reelAsset(session.generatedAssets);
  const reelSrc = reel ? shareAssetUrl(reel.objectKey, token) : null;
  const cta = useMemo(
    () => dateCtaFor(venue, { weddingMonth: session.weddingMonth, coupleName: session.coupleName }),
    [venue, session.weddingMonth, session.coupleName],
  );
  const monthLabel = formatWeddingMonth(session.weddingMonth);
  const incentive = venue?.incentiveText?.trim() || null;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sendEmail = useSendSessionEmailByToken();

  const track = useCallback((type: GalleryEventType) => void postGalleryEvent(token, type), [token]);

  const onShare = async () => {
    const result = await shareGallery({ shareToken: token, venueName: venue?.name ?? null, coupleName: session.coupleName ?? null });
    if (result === "shared" || result === "copied") track("shared");
    if (result === "copied") toast({ title: "Link copied", description: "Paste it to share your gallery." });
    if (result === "failed") toast({ title: "Couldn't share", description: "Copy the address from your browser bar." });
  };

  const onCopy = async () => {
    const ok = await copyShareLink(token);
    if (ok) track("shared");
    toast({
      title: ok ? "Link copied" : "Couldn't copy",
      description: ok ? "Anyone with the link can see this gallery." : "Copy the address from your browser bar.",
    });
  };

  const onEmailMe = () =>
    sendEmail.mutate(
      { shareToken: token, data: {} },
      {
        onSuccess: (res) =>
          toast({
            title: res.sent ? "On its way" : "Not sent",
            description: res.sent
              ? `We emailed the link to ${creator?.email ?? "the address you gave us"}.`
              : "We couldn't send it just now. Copy the link to keep it safe.",
          }),
        onError: (err) =>
          toast({
            title: "Not sent",
            description: (err.data as { error?: string } | null)?.error ?? "Try again in a few minutes.",
            variant: "destructive",
          }),
      },
    );

  const title = session.coupleName?.trim() ? `${session.coupleName.trim()} at ${venueName}` : `The two of you at ${venueName}`;

  return (
    <CoupleChrome
      venue={venue}
      eyebrow="Your preview at"
      action={cta ? <DateCtaLink cta={cta} compact onClick={() => track("cta_click")} testId="venue-cta-header" /> : null}
      mainClassName="gs-main"
      footerNote={`Every image here is an AI preview, imagined at ${venueName} from the couple's photos and the venue's own photos.`}
    >
      <div className="gs-page" data-testid="gallery-view" data-has-sticky={!!cta}>
        <section className="gs-hero">
          <div className="gs-hero__media">
            {reelSrc ? (
              <video
                src={reelSrc}
                poster={shareAssetUrl(stills[0]!.objectKey, token)}
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
                aria-label={`Your reel at ${venueName}, AI preview`}
                data-testid="gallery-reel"
              />
            ) : (
              <img src={shareAssetUrl(stills[0]!.objectKey, token)} alt={`AI preview of the two of you at ${venueName}`} />
            )}
            <span className="gs-tag">AI preview, imagined at {venueName}</span>
          </div>
          <div className="gs-hero__copy">
            <p className="eyebrow">Your gallery</p>
            <h1>{title}</h1>
            <p className="cp-lede">
              Four images and a short reel, imagined in {venueName}'s real spaces from your photos.
            </p>
            {cta ? (
              <div className="gs-apex">
                <DateCtaLink cta={cta} onClick={() => track("cta_click")} testId="venue-contact-cta" />
                {incentive ? <p className="gs-incentive">{incentive}</p> : null}
                {monthLabel ? <p className="cp-help">We'll pass on {monthLabel} when you ask.</p> : null}
              </div>
            ) : null}
            <div className="gs-toolbar" role="group" aria-label="Share and save">
              <button type="button" onClick={() => void onShare()} data-testid="share-button">
                <Share2 size={16} /> Share
              </button>
              <button type="button" onClick={() => void onCopy()} data-testid="copy-link-button">
                <Link2 size={16} /> Copy link
              </button>
              {reelSrc ? (
                <a href={reelSrc} download onClick={() => track("download")} data-testid="gallery-download-reel">
                  <Download size={16} /> Save reel
                </a>
              ) : null}
              {creator && session.hasCoupleEmail ? (
                <button type="button" onClick={onEmailMe} disabled={sendEmail.isPending} data-testid="send-email-button">
                  {sendEmail.isPending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Email me the
                  link
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="gs-stills" aria-labelledby="stills-heading">
          <h2 id="stills-heading" className="gs-section-title">
            Imagined here, beside the real thing
          </h2>
          {stills.map((still, i) => {
            const real = venue ? realSpaceFor(still, venue.media) : null;
            const name = sceneTitle(still);
            const src = shareAssetUrl(still.objectKey, token);
            return (
              <figure className="gs-pair" key={still.id} data-has-real={!!real}>
                <button
                  type="button"
                  className="gs-pair__ai"
                  onClick={() => setLightbox(i)}
                  aria-label={`Open image ${i + 1} of ${stills.length}${name ? `, ${name}` : ""}`}
                  data-testid={`gallery-still-${i}`}
                >
                  <img src={src} alt={`AI preview of the couple at ${venueName}${name ? `: ${name.toLowerCase()}` : ""}`} loading={i === 0 ? "eager" : "lazy"} />
                  <span className="gs-tag">AI preview, imagined at {venueName}</span>
                </button>
                {real && venue ? (
                  <div className="gs-pair__real">
                    <img src={venueMediaUrl(real.objectKey, venue.slug)} alt={`${venueName}, the real space`} loading="lazy" />
                    <span className="gs-tag gs-tag--real">The real space</span>
                  </div>
                ) : null}
                <figcaption>
                  <span>
                    {String(i + 1).padStart(2, "0")}
                    {name ? ` · ${name}` : ""}
                  </span>
                  <a href={src} download onClick={() => track("download")} data-testid={`gallery-still-download-${i}`}>
                    <Download size={15} /> Save
                  </a>
                </figcaption>
              </figure>
            );
          })}
        </section>

        <section className="gs-closing">
          {cta ? (
            <>
              <p className="eyebrow">Like what you see?</p>
              <h2>Make it real at {venueName}.</h2>
              {incentive ? <p className="gs-incentive">{incentive}</p> : null}
              <DateCtaLink cta={cta} onClick={() => track("cta_click")} testId="venue-cta-closing" />
            </>
          ) : (
            <>
              <p className="eyebrow">Your gallery</p>
              <h2>Keep this link to come back any time.</h2>
            </>
          )}
          {creator && venue ? (
            <Button
              variant="ghost"
              className="gs-restart"
              onClick={() => navigate(`/preview/${venue.slug}`)}
              data-testid="gallery-restart"
            >
              <RotateCcw /> Make another gallery
            </Button>
          ) : null}
        </section>
      </div>

      {cta ? (
        <div className="gs-sticky" data-testid="gallery-sticky-cta">
          <span className="gs-sticky__venue">{venueName}</span>
          <DateCtaLink cta={cta} compact onClick={() => track("cta_click")} testId="venue-cta-sticky" />
        </div>
      ) : null}

      <Lightbox
        stills={stills}
        index={lightbox}
        token={token}
        venueName={venueName}
        onIndex={setLightbox}
        onDownload={() => track("download")}
      />
    </CoupleChrome>
  );
}

/* ————— Lightbox ————— */

function Lightbox({
  stills,
  index,
  token,
  venueName,
  onIndex,
  onDownload,
}: {
  stills: GeneratedAsset[];
  index: number | null;
  token: string;
  venueName: string;
  onIndex: (index: number | null) => void;
  onDownload: () => void;
}) {
  const open = index !== null;
  const current = index !== null ? stills[index] : undefined;
  const swipeStart = useRef<number | null>(null);
  const count = stills.length;

  const step = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndex((index + delta + count) % count);
    },
    [index, count, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  const onPointerDown = (e: ReactPointerEvent) => {
    swipeStart.current = e.clientX;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (swipeStart.current === null) return;
    const dx = e.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  };

  const src = current ? shareAssetUrl(current.objectKey, token) : "";
  const name = current ? sceneTitle(current) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onIndex(null)}>
      <DialogContent variant="bare" className="gs-lightbox">
        <DialogTitle className="sr-only">
          Image {(index ?? 0) + 1} of {count}
        </DialogTitle>
        <DialogDescription className="sr-only">AI preview, imagined at {venueName}. Swipe or use the arrow keys.</DialogDescription>
        {current ? (
          <div className="gs-lightbox__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
            <img src={src} alt={`AI preview of the couple at ${venueName}`} draggable={false} />
          </div>
        ) : null}
        <div className="gs-lightbox__bar">
          <button type="button" onClick={() => step(-1)} aria-label="Previous image" disabled={count < 2}>
            <ChevronLeft size={20} />
          </button>
          <p>
            {(index ?? 0) + 1} / {count}
            {name ? ` · ${name}` : ""} · AI preview, imagined at {venueName}
          </p>
          <a href={src} download onClick={onDownload} aria-label="Save this image">
            <Download size={18} />
          </a>
          <button type="button" onClick={() => step(1)} aria-label="Next image" disabled={count < 2}>
            <ChevronRight size={20} />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

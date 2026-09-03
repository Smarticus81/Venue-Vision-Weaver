import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetVenue,
  getGetVenueQueryKey,
  useCreateSession,
  useListGalleryStyles,
  type VenuePublicResponse,
  type GalleryStyleSummary,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { useSavedSessions } from "@/lib/savedSessions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  Camera,
  X,
  Images,
  Check,
  Home,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { FrameTicks } from "@/components/motion";

function venueMediaUrl(objectKey: string | undefined, venueSlug: string): string {
  if (!objectKey) return "";
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTOS = 1;
const MIN_COUPLE_PHOTO_EDGE = 256;
const MAX_COUPLE_PHOTO_BYTES = 50 * 1024 * 1024;
const ALLOWED_COUPLE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COUPLE_REFERENCE_ROLES = ["Together", "Partner A", "Partner B"] as const;
const COUPLE_REFERENCE_GUIDANCE = [
  "Both faces visible",
  "Face-forward close view",
  "Face-forward close view",
] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CouplePage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  // Successful uploads keyed by File so a retry after a failure never re-uploads them.
  const uploadedKeysRef = useRef(new Map<File, string>());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [coupleName, setCoupleName] = useState("");
  const [coupleEmail, setCoupleEmail] = useState("");

  const venueQuery = useGetVenue(slug!, {
    query: {
      enabled: !!slug,
      queryKey: getGetVenueQueryKey(slug!),
      // A wrong code is a 404: show "not found" now instead of retrying for seconds.
      retry: (count, err) => (err as { status?: number }).status !== 404 && count < 1,
    },
  });
  const stylesQuery = useListGalleryStyles();

  const createSession = useCreateSession();
  const { uploadFile, isUploading } = useUpload({
    purpose: "couple",
    venueSlug: slug,
    uploadToken: venueQuery.data?.uploadToken,
  });
  const { save: saveSession } = useSavedSessions(slug);

  const validatePhotoDimensions = (file: File): Promise<boolean> =>
    new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img.width >= MIN_COUPLE_PHOTO_EDGE && img.height >= MIN_COUPLE_PHOTO_EDGE);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const remainingSlots = MAX_COUPLE_PHOTOS - selectedFiles.length;
    if (remainingSlots <= 0) {
      toast({
        title: "Photo limit reached",
        description: `Use your best ${MAX_COUPLE_PHOTOS} couple reference photos.`,
      });
      e.target.value = "";
      return;
    }

    const accepted: File[] = [];
    for (const file of files) {
      if (accepted.length >= remainingSlots) {
        toast({
          title: "Photo limit reached",
          description: `We kept the first ${remainingSlots} valid photo${remainingSlots === 1 ? "" : "s"} from this selection.`,
        });
        break;
      }
      if (!ALLOWED_COUPLE_PHOTO_TYPES.has(file.type)) {
        toast({
          title: "Unsupported photo type",
          description: "Upload JPG, PNG, or WebP images.",
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_COUPLE_PHOTO_BYTES) {
        toast({
          title: "Photo too large",
          description: "Upload images up to 50MB.",
          variant: "destructive",
        });
        continue;
      }
      const ok = await validatePhotoDimensions(file);
      if (!ok) {
        toast({
          title: "Photo too small",
          description: "Use clear photos at least 256px wide and tall, with both faces visible and well lit.",
          variant: "destructive",
        });
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) {
      setSelectedFiles((prev) => {
        const combined = [...prev, ...accepted];
        return combined.slice(0, MAX_COUPLE_PHOTOS);
      });
      setPreviews((prev) => {
        const newPreviews = accepted.map((file) => URL.createObjectURL(file));
        return [...prev, ...newPreviews].slice(0, MAX_COUPLE_PHOTOS);
      });
    }
    e.target.value = "";
  };

  const handleRemovePhoto = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => {
      const url = prev[index];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    const email = coupleEmail.trim().toLowerCase();
    if (selectedFiles.length < MIN_COUPLE_PHOTOS || !selectedStyleId || !email) return;
    if (!EMAIL_PATTERN.test(email)) {
      toast({
        title: "Check your email address",
        description: "We need a valid email so you can find your gallery again.",
        variant: "destructive",
      });
      return;
    }

    setStep(4);
    try {
      const objectKeys = await Promise.all(
        selectedFiles.map(async (file) => {
          const cached = uploadedKeysRef.current.get(file);
          if (cached) return cached;
          const result = await uploadFile(file);
          if (!result) throw new Error("upload-failed");
          uploadedKeysRef.current.set(file, result.objectPath);
          return result.objectPath;
        })
      );

      createSession.mutate(
        {
          slug: slug!,
          data: {
            couplePhotoKeys: objectKeys,
            styleId: selectedStyleId,
            coupleName: coupleName.trim() || undefined,
            coupleEmail: email,
          },
        },
        {
          onSuccess: (session) => {
            saveSession(session.shareToken, session.id, slug!);
            setLocation(`/v/${session.shareToken}`);
          },
          onError: (err: ErrorType<ErrorEnvelope>) => {
            setStep(3);
            const msg = err.data?.error ?? "We couldn't start your session";
            toast({
              title: err.status === 402 ? "The studio is paused" : "We couldn't begin",
              description:
                err.status === 402
                  ? "This venue is temporarily unavailable for new galleries. Please check with the venue team."
                  : msg,
              variant: "destructive",
            });
          },
        }
      );
    } catch {
      setStep(3);
      toast({
        title: "Photos didn't upload",
        description:
          "Check your connection and tap Compose my gallery again — everything you entered is still here.",
        variant: "destructive",
      });
    }
  };

  if (venueQuery.isLoading) return <CoupleSkeleton />;

  if (venueQuery.isError || !venueQuery.data) {
    return (
      <CoupleStatePage
        eyebrow="Venue code"
        title="We couldn't find that venue"
        actions={
          <Button onClick={() => setLocation("/couple")} variant="rose" className="h-12 px-8 text-base" data-testid="venue-notfound-home">
            Enter another code
          </Button>
        }
      >
        No venue answers to the code <span className="font-mono text-foreground">{slug}</span>. Check the
        code on your venue's card or email and try again.
      </CoupleStatePage>
    );
  }

  const venue = venueQuery.data;

  // Readiness comes from the API (isReady: the venue has reference
  // photography). Mirrors the server's own session-create guard, so a couple
  // who passes here never hits a readiness error later. Any ready venue goes
  // straight into the experience.
  if (!venue.isReady) {
    return (
      <CoupleStatePage
        eyebrow="Opening soon"
        title={`${venue.name} is putting on the finishing touches`}
        actions={
          <>
            <Button onClick={() => venueQuery.refetch()} variant="rose" className="h-12 px-8 text-base" data-testid="venue-not-ready-refresh">
              Check again
            </Button>
            {(venue.websiteUrl || venue.bookingUrl) && (
              <Button asChild variant="ghost" className="h-12 px-6 text-base text-muted-foreground hover:text-foreground" data-testid="venue-not-ready-site">
                <a href={venue.websiteUrl ?? venue.bookingUrl ?? "#"} target="_blank" rel="noreferrer">
                  Visit {venue.name}
                </a>
              </Button>
            )}
          </>
        }
      >
        Your preview isn't open quite yet. Check back shortly — we can't wait to show you your day here.
      </CoupleStatePage>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans relative flex flex-col overflow-x-hidden">
      <AnimatePresence mode="wait">
        {step === 1 && (
          <VenueShowcase key="step1" venue={venue} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <UploadStep
            key="step2"
            previews={previews}
            isUploading={isUploading || createSession.isPending}
            onFileChange={handleFileChange}
            onRemovePhoto={handleRemovePhoto}
            onContinue={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <StyleStep
            key="step3"
            styles={stylesQuery.data?.styles ?? []}
            isLoading={stylesQuery.isLoading}
            selectedStyleId={selectedStyleId}
            onSelect={setSelectedStyleId}
            coupleName={coupleName}
            onChangeCoupleName={setCoupleName}
            coupleEmail={coupleEmail}
            onChangeCoupleEmail={setCoupleEmail}
            onSubmit={handleSubmit}
            onBack={() => setStep(2)}
            isSubmitting={isUploading || createSession.isPending}
          />
        )}
        {step === 4 && <SubmittingStep key="step4" />}
      </AnimatePresence>
    </div>
  );
}

function CoupleStatePage({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="grain relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/couple" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="mono-label mb-4 text-rose">{eyebrow}</p>
        <h1 className="max-w-2xl font-display text-3xl font-medium tracking-tight md:text-4xl">{title}</h1>
        <div className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{children}</div>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">{actions}</div>
      </main>
    </div>
  );
}

interface VenueShowcaseProps {
  venue: VenuePublicResponse;
  onNext: () => void;
}

function VenueShowcase({ venue, onNext }: VenueShowcaseProps) {
  const [, setLocation] = useLocation();
  const [currentPhoto, setCurrentPhoto] = useState(0);

  const hasMedia = venue.media.length > 0;

  useEffect(() => {
    if (venue.media.length <= 1) return undefined;
    const t = setTimeout(
      () => setCurrentPhoto((p) => (p + 1) % venue.media.length),
      4000
    );
    return () => clearTimeout(t);
  }, [currentPhoto, venue.media.length]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-0 overflow-hidden bg-background"
    >
      <div className="absolute inset-0 z-0">
        {hasMedia ? (
          <AnimatePresence mode="wait">
            <motion.img
              key={currentPhoto}
              src={venueMediaUrl(venue.media[currentPhoto]?.objectKey, venue.slug)}
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="w-full h-full object-cover"
            />
          </AnimatePresence>
        ) : (
          <div className="w-full h-full bg-card" />
        )}
      </div>

      <div className="absolute inset-0 z-10 bg-gradient-to-t from-background/90 via-background/30 to-background/40" />

      <header className="absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/couple" className="[text-shadow:0_1px_10px_rgba(0,0,0,0.5)]" />
        <button
          type="button"
          onClick={() => setLocation("/couple")}
          className="mono-label inline-flex min-h-10 items-center gap-2 text-foreground/80 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]"
          data-testid="venueshow-home"
        >
          <Home className="h-3.5 w-3.5" /> Another venue
        </button>
      </header>

      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-24 md:pb-32 px-6 text-center">
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <p className="mono-label mb-6 text-rose drop-shadow-md">A glimpse of your day at</p>

          <h1 className="font-display text-5xl md:text-7xl font-medium mb-6 text-foreground tracking-[-0.02em] drop-shadow-2xl">
            {venue.name}
          </h1>
          
          {venue.tagline && (
            <p className="text-xl md:text-2xl text-rose mb-8 font-light drop-shadow-lg italic font-display">
              {venue.tagline}
            </p>
          )}
          
          {venue.description && (
            <p className="text-lg md:text-xl text-foreground/90 mb-12 max-w-2xl mx-auto drop-shadow-lg leading-relaxed font-light">
              {venue.description}
            </p>
          )}
          
          <Button
            size="lg"
            variant="rose"
            onClick={onNext}
            className="px-10 py-7 text-lg font-medium group"
            data-testid="visualize-cta"
          >
            Step inside your wedding day
            <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}

interface UploadStepProps {
  previews: string[];
  isUploading: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: (index: number) => void;
  onContinue: () => void;
  onBack: () => void;
}

/** Shared header for the two form steps: where you are, and a way out. */
function StepFrame({
  step,
  title,
  lede,
  onExit,
  exitDisabled,
  children,
  wide = false,
}: {
  step: 1 | 2;
  title: string;
  lede: string;
  onExit: () => void;
  exitDisabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-1 flex-col"
    >
      <header className="flex h-16 items-center justify-between px-5 md:h-20 md:px-10">
        <button
          type="button"
          onClick={onExit}
          disabled={exitDisabled}
          className="mono-label inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid={step === 1 ? "upload-home" : "style-home"}
        >
          <Home className="h-3.5 w-3.5" /> Start over
        </button>
        <ol className="flex items-center gap-2" aria-label="Progress">
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              aria-current={n === step ? "step" : undefined}
              className={`h-1 w-8 rounded-full ${n < step ? "bg-rose/50" : n === step ? "bg-rose" : "bg-border"}`}
            >
              <span className="sr-only">{n < step ? `Step ${n}, done` : n === step ? `Step ${n}, current` : `Step ${n}`}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className={`mx-auto w-full flex-1 px-5 pb-16 pt-6 md:px-10 md:pt-10 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <p className="mono-label mb-3 text-rose">Step {step} of 3</p>
        <h2 className="font-display text-3xl font-medium tracking-tight md:text-4xl">{title}</h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">{lede}</p>
        {children}
      </div>
    </motion.div>
  );
}

/**
 * Three named slots are the upload targets. Guidance, action, and preview
 * share one tile each, so the page never repeats itself.
 */
function UploadStep({ previews, isUploading, onFileChange, onRemovePhoto, onContinue, onBack }: UploadStepProps) {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasEnoughReferences = previews.length >= MIN_COUPLE_PHOTOS;
  const canAddMoreReferences = previews.length < MAX_COUPLE_PHOTOS;
  const remaining = Math.max(MIN_COUPLE_PHOTOS - previews.length, 0);

  return (
    <StepFrame
      step={1}
      title="Two faces we can trust"
      lede="One photo of you together is enough. Add one of each of you for the closest likeness."
      onExit={() => setLocation("/couple")}
    >
      <input
        type="file"
        multiple
        hidden
        ref={fileInputRef}
        onChange={onFileChange}
        disabled={!canAddMoreReferences || isUploading}
        accept="image/jpeg,image/png,image/webp"
        data-testid="couple-photo-input"
      />

      <ul className="mt-8 grid grid-cols-3 gap-3 md:gap-4" aria-label="Your photos">
        {COUPLE_REFERENCE_ROLES.map((role, index) => {
          const src = previews[index];
          const required = index === 0;
          return (
            <li key={role} className="min-w-0">
              {src ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="group relative aspect-[3/4] overflow-hidden border border-rose/60 bg-card"
                >
                  <img src={src} alt={`${role} photo`} className="h-full w-full object-cover" />
                  <FrameTicks size={14} className="text-white/70" />
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                  <p className="mono-label absolute bottom-2.5 left-3 text-white">{role}</p>
                  <button
                    type="button"
                    onClick={() => onRemovePhoto(index)}
                    disabled={isUploading}
                    aria-label={`Remove ${role} photo`}
                    data-testid={`remove-couple-photo-${index}`}
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canAddMoreReferences || isUploading}
                  aria-label={`Add ${role} photo`}
                  data-testid={`couple-slot-${index}`}
                  className={`flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 border border-dashed px-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                    required && previews.length === 0
                      ? "border-rose/70 bg-card text-rose hover:bg-accent/40"
                      : "border-border bg-card/50 text-muted-foreground hover:border-rose/60 hover:text-foreground"
                  }`}
                >
                  <Camera className="h-6 w-6" />
                  <span className="mono-label">{role}</span>
                  <span className="text-xs leading-snug">{COUPLE_REFERENCE_GUIDANCE[index]}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mono-label mt-5 text-muted-foreground" data-testid="couple-photo-status" aria-live="polite">
        {hasEnoughReferences
          ? `${previews.length} of ${MAX_COUPLE_PHOTOS} added`
          : `${remaining} photo${remaining === 1 ? "" : "s"} needed to continue`}
        <span className="normal-case tracking-normal"> · JPG, PNG or WebP · well lit, faces clear</span>
      </p>

      <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack} className="h-12 px-4 text-base text-muted-foreground hover:text-foreground sm:w-auto">
          Back
        </Button>
        <Button
          variant="rose"
          onClick={onContinue}
          disabled={!hasEnoughReferences || isUploading}
          className="h-12 px-8 text-base"
          data-testid="choose-style-button"
        >
          Choose a style
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </StepFrame>
  );
}

interface StyleStepProps {
  styles: GalleryStyleSummary[];
  isLoading: boolean;
  selectedStyleId: string | null;
  onSelect: (id: string) => void;
  coupleName: string;
  onChangeCoupleName: (v: string) => void;
  coupleEmail: string;
  onChangeCoupleEmail: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

function StyleStep({ styles, isLoading, selectedStyleId, onSelect, coupleName, onChangeCoupleName, coupleEmail, onChangeCoupleEmail, onSubmit, onBack, isSubmitting }: StyleStepProps) {
  const [, setLocation] = useLocation();
  const inputClass =
    "h-12 w-full rounded-md border border-input bg-background px-4 text-base text-foreground placeholder:text-muted-foreground focus:border-rose focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50";
  const canSubmit = Boolean(selectedStyleId) && coupleEmail.trim().length > 0 && !isSubmitting;

  return (
    <StepFrame
      step={2}
      title="Set the scene"
      lede="Pick the light your day should have. Your four portraits and the reel follow it."
      onExit={() => setLocation("/couple")}
      exitDisabled={isSubmitting}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className="mt-8" disabled={isSubmitting}>
          <legend className="sr-only">Gallery style</legend>
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-none" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {styles.map((style) => {
                const isSelected = selectedStyleId === style.id;
                return (
                  <label
                    key={style.id}
                    className={`relative flex cursor-pointer items-start gap-4 border p-5 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring md:p-6 ${
                      isSelected ? "border-rose bg-card" : "border-border bg-card/60 hover:border-rose/40 hover:bg-card"
                    }`}
                  >
                    <input
                      type="radio"
                      name="gallery-style"
                      value={style.id}
                      checked={isSelected}
                      onChange={() => onSelect(style.id)}
                      className="sr-only"
                      data-testid={`style-option-${style.id}`}
                    />
                    <span
                      aria-hidden
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center border transition-colors ${
                        isSelected ? "border-rose bg-rose text-rose-foreground" : "border-border"
                      }`}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-xl font-medium leading-tight tracking-tight md:text-2xl">{style.name}</span>
                      <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">{style.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="mt-10 grid gap-5 border-t border-border pt-8 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="couple-email" className="mono-label block text-muted-foreground">
              Your email
            </label>
            <input
              id="couple-email"
              type="email"
              required
              placeholder="you@example.com"
              value={coupleEmail}
              onChange={(e) => onChangeCoupleEmail(e.target.value)}
              disabled={isSubmitting}
              autoComplete="email"
              inputMode="email"
              data-testid="style-couple-email"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">We send your gallery link here, so you can always find it.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="couple-name-optional" className="mono-label block text-muted-foreground">
              Your names <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="couple-name-optional"
              type="text"
              placeholder="Avery & Jordan"
              value={coupleName}
              onChange={(e) => onChangeCoupleName(e.target.value)}
              disabled={isSubmitting}
              autoComplete="off"
              maxLength={80}
              data-testid="style-couple-name"
              className={inputClass}
            />
            <p className="text-xs text-muted-foreground">Headlines your gallery.</p>
          </div>
        </div>

        <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting} className="h-12 px-4 text-base text-muted-foreground hover:text-foreground sm:w-auto" data-testid="style-back-button">
            Back
          </Button>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Button type="submit" variant="rose" disabled={!canSubmit} className="h-12 px-8 text-base" data-testid="generate-button">
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Images className="h-5 w-5" />}
              Create my gallery
            </Button>
            <p className="text-xs text-muted-foreground sm:text-right">Four portraits and a reel, usually ready in a few minutes.</p>
          </div>
        </div>
      </form>
    </StepFrame>
  );
}

function SubmittingStep() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 flex-col items-center justify-center px-6 text-center"
      aria-busy="true"
    >
      <Loader2 className="mb-8 h-8 w-8 animate-spin text-rose" />
      <p className="mono-label mb-4 text-rose">Sending your photos</p>
      <h2 className="font-display text-3xl font-medium tracking-tight md:text-4xl">One moment.</h2>
      <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
        Your gallery page opens next and keeps developing there, even if you close this tab.
      </p>
    </motion.div>
  );
}

function CoupleSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" aria-busy="true" aria-label="Opening the venue">
      <header className="flex h-16 items-center px-5 md:h-20 md:px-10">
        <GlimpseLogo href="/couple" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-5 pb-24">
        <Loader2 className="h-8 w-8 animate-spin text-rose" />
        <p className="mono-label text-muted-foreground">Opening the venue…</p>
      </main>
    </div>
  );
}

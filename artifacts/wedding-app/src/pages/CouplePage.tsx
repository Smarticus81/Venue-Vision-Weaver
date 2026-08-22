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
  Heart,
  X,
  Images,
  Clock,
  Check,
  Home,
  Mail,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlimpseShell } from "@/components/layout/GlimpseShell";
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
    query: { enabled: !!slug, queryKey: getGetVenueQueryKey(slug!) },
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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
        <Heart className="h-12 w-12 text-muted-foreground/40 mb-6" />
        <p className="mono-label text-rose mb-4">Venue code</p>
        <h1 className="font-display text-3xl md:text-4xl font-medium mb-4 text-foreground">We couldn't find that venue</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-md font-light">
          No venue answers to the code "{slug}". Double-check the code from
          your venue and try again.
        </p>
        <Button
          onClick={() => setLocation("/couple")}
          variant="rose"
          className="px-8 py-6 text-base font-medium"
          data-testid="venue-notfound-home"
        >
          Enter another code
        </Button>
      </div>
    );
  }

  const venue = venueQuery.data;

  // Readiness comes from the API (isReady: the venue has reference
  // photography). Mirrors the server's own session-create guard, so a couple
  // who passes here never hits a readiness error later. Any ready venue goes
  // straight into the experience.
  if (!venue.isReady) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
        <Heart className="h-12 w-12 text-rose/40 mb-6" />
        <p className="mono-label text-rose mb-4">Opening soon</p>
        <h1 className="font-display text-3xl md:text-4xl font-medium mb-4 text-foreground">
          {venue.name} is putting on the finishing touches
        </h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-md font-light">
          Your interactive preview isn't open quite yet — please check back
          shortly. We can't wait to show you your day here.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Button
            onClick={() => venueQuery.refetch()}
            variant="rose"
            className="px-8 py-6 text-base font-medium"
            data-testid="venue-not-ready-refresh"
          >
            Check again
          </Button>
          {(venue.websiteUrl || venue.bookingUrl) && (
            <Button
              asChild
              variant="ghost"
              className="px-8 py-6 text-base font-medium text-muted-foreground hover:text-foreground"
              data-testid="venue-not-ready-site"
            >
              <a href={venue.websiteUrl ?? venue.bookingUrl ?? "#"} target="_blank" rel="noreferrer">
                Visit {venue.name}
              </a>
            </Button>
          )}
        </div>
      </div>
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

      <div className="absolute top-6 left-6 z-30 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-foreground/80 hover:text-foreground hover:bg-foreground/10 backdrop-blur px-5 py-2 font-medium"
          data-testid="venueshow-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-24 md:pb-32 px-6 text-center">
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <p className="mono-label mb-6 text-rose drop-shadow-md">Interactive preview</p>

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

function UploadStep({ previews, isUploading, onFileChange, onRemovePhoto, onContinue, onBack }: UploadStepProps) {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasEnoughReferences = previews.length >= MIN_COUPLE_PHOTOS;
  const canAddMoreReferences = previews.length < MAX_COUPLE_PHOTOS;
  const remainingReferences = Math.max(MIN_COUPLE_PHOTOS - previews.length, 0);
  const uploadStatus = hasEnoughReferences
    ? `${previews.length}/${MAX_COUPLE_PHOTOS} reference photos added`
    : `${remainingReferences} more clear photo${remainingReferences === 1 ? "" : "s"} needed`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 flex flex-col items-center justify-center px-6 max-w-4xl mx-auto w-full py-16 md:py-24 relative"
    >
      <div className="absolute top-6 left-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-muted-foreground hover:text-foreground hover:bg-accent font-medium"
          data-testid="upload-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-12">
        <p className="mono-label text-rose mb-4">Step 01 / 03</p>
        <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground mb-4">
          You and your partner
        </h2>
        <p className="text-muted-foreground font-light text-lg max-w-lg mx-auto">
          Upload clear, well-lit photos in this order: together, Partner A, then Partner B.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 w-full">
        {COUPLE_REFERENCE_ROLES.map((role, index) => {
          const isFilled = previews.length > index;
          return (
            <div
              key={role}
              className={`rounded-lg border p-6 transition-colors duration-300 ${
                isFilled
                  ? "border-rose bg-card"
                  : "border-border bg-card/50"
              }`}
            >
              <p className={`mono-label mb-2 ${isFilled ? "text-rose" : "text-muted-foreground"}`}>
                0{index + 1} — {role}
              </p>
              <p className={`font-light text-sm ${isFilled ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                {COUPLE_REFERENCE_GUIDANCE[index]}
              </p>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="w-full rounded-lg border border-dashed border-border bg-card/50 hover:border-rose/50 hover:bg-card active:border-rose transition-colors cursor-pointer flex flex-col items-center justify-center py-12 md:py-16 px-6 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card/50"
        onClick={() => fileInputRef.current?.click()}
        disabled={!canAddMoreReferences || isUploading}
        aria-label="Add photos"
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
        <div className="relative w-16 h-16 bg-card flex items-center justify-center mb-6 border border-border text-rose">
          <FrameTicks size={8} className="text-foreground/40" />
          <Camera className="h-7 w-7" />
        </div>
        <p className="font-display text-xl font-medium text-foreground mb-3">Tap to add photographs</p>
        <p className="text-base text-muted-foreground font-light max-w-md mx-auto">
          One to three JPG, PNG, or WebP photos under 50MB — distinct angles or expressions, at least 256px wide.
        </p>
        <p className="mono-label mt-6 text-rose" data-testid="couple-photo-status">
          {uploadStatus}
        </p>
      </button>

      {previews.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-8 w-full">
          {previews.map((src, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative group aspect-square overflow-hidden border border-border"
            >
              <img src={src} className="w-full h-full object-cover" alt={`${COUPLE_REFERENCE_ROLES[i] ?? "Reference"} preview`} />
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <FrameTicks size={14} className="text-foreground/40" />
              <p className="absolute left-4 bottom-4 mono-label text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                {COUPLE_REFERENCE_ROLES[i] ?? `Reference ${i + 1}`}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemovePhoto(i);
                }}
                disabled={isUploading}
                aria-label={`Remove photo ${i + 1}`}
                data-testid={`remove-couple-photo-${i}`}
                className="absolute top-4 right-4 h-8 w-8 bg-black/60 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-destructive backdrop-blur-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 mt-12 w-full max-w-lg mx-auto">
        <Button variant="ghost" onClick={onBack} className="w-full sm:w-1/3 py-6 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
          Back
        </Button>
        <Button
          variant="rose"
          onClick={onContinue}
          disabled={!hasEnoughReferences || isUploading}
          className="w-full sm:w-2/3 py-6 text-base font-medium"
          data-testid="choose-style-button"
        >
          Continue to styles
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 flex flex-col items-center px-6 max-w-5xl mx-auto w-full py-16 md:py-24 relative"
    >
      <div className="absolute top-6 left-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          disabled={isSubmitting}
          className="text-muted-foreground hover:text-foreground hover:bg-accent font-medium"
          data-testid="style-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-12">
        <p className="mono-label text-rose mb-4">Step 02 / 03</p>
        <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground mb-4">Set the scene</h2>
        <p className="text-muted-foreground font-light text-lg max-w-xl mx-auto">
          Choose the editorial direction for your venue-branded glimpse gallery.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
          {styles.map((style, index) => {
            const isSelected = selectedStyleId === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => onSelect(style.id)}
                disabled={isSubmitting}
                data-testid={`style-option-${style.id}`}
                className={`relative text-left rounded-lg p-6 md:p-8 border transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-rose bg-card"
                    : "border-border bg-card hover:border-rose/40 hover:bg-accent/40"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className={`mono-label mb-2 ${isSelected ? "text-rose" : "text-muted-foreground"}`}>
                      Style {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="font-display font-medium text-xl md:text-2xl mb-2 tracking-tight text-foreground">{style.name}</h3>
                    <p className="text-sm md:text-base text-muted-foreground font-light leading-relaxed">
                      {style.description}
                    </p>
                  </div>
                  <div
                    aria-hidden
                    className={`shrink-0 h-6 w-6 border flex items-center justify-center transition-colors mt-1 ${
                      isSelected
                        ? "bg-rose border-rose text-rose-foreground"
                        : "border-border text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <form
        className="w-full flex flex-col items-center"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
      <div className="mt-16 w-full max-w-2xl space-y-6">
        <div className="rounded-lg bg-card border border-border p-6 md:p-8">
          <label
            htmlFor="couple-email"
            className="mono-label text-rose flex items-center gap-2 mb-2"
          >
            <Mail className="h-4 w-4" /> Your email
          </label>
          <p className="text-sm text-muted-foreground font-light mb-4">
            Required so we can send your gallery link and you can find it again later.
          </p>
          <input
            id="couple-email"
            type="email"
            required
            placeholder="you@example.com"
            value={coupleEmail}
            onChange={(e) => onChangeCoupleEmail(e.target.value)}
            disabled={isSubmitting}
            autoComplete="email"
            data-testid="style-couple-email"
            className="w-full bg-background border border-input rounded-none px-4 py-3 md:py-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-rose disabled:opacity-50 transition-colors placeholder:text-muted-foreground"
          />
        </div>

        <div className="rounded-lg bg-card border border-border p-6 md:p-8">
          <label
            htmlFor="couple-name-optional"
            className="mono-label text-rose mb-4 block"
          >
            Your names (optional)
          </label>
          <input
            id="couple-name-optional"
            type="text"
            placeholder="Jane & John"
            value={coupleName}
            onChange={(e) => onChangeCoupleName(e.target.value)}
            disabled={isSubmitting}
            autoComplete="name"
            maxLength={80}
            data-testid="style-couple-name"
            className="w-full bg-background border border-input rounded-none px-4 py-3 md:py-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-rose disabled:opacity-50 transition-colors placeholder:text-muted-foreground"
          />
        </div>

        <div className="relative rounded-lg bg-card border border-border p-6 md:p-8">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-rose" />
            <p className="mono-label text-rose">
              Gallery Delivery
            </p>
          </div>
          <div className="font-display text-xl md:text-2xl font-medium text-foreground mb-2">4 portraits + motion reel</div>
          <div className="text-base text-muted-foreground font-light leading-relaxed">
            Editorial portraits anchored to this venue, compiled into a gentle branded reel. Usually ready in a few minutes.
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mt-12 w-full max-w-lg mx-auto">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isSubmitting}
          className="w-full sm:w-1/3 py-6 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="style-back-button"
        >
          Back
        </Button>
        <Button
          type="submit"
          variant="rose"
          disabled={!selectedStyleId || !coupleEmail.trim() || isSubmitting}
          className="w-full sm:w-2/3 py-6 text-base font-medium"
          data-testid="generate-button"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Images className="mr-2 h-5 w-5" />
          )}
          Compose my gallery
        </Button>
      </div>
      </form>
    </motion.div>
  );
}

function SubmittingStep() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-2xl mx-auto"
    >
      <div className="relative w-20 h-20 bg-card border border-border flex items-center justify-center mb-8">
        <FrameTicks size={10} className="text-foreground/40" />
        <Loader2 className="h-8 w-8 animate-spin text-rose" />
      </div>
      <p className="mono-label text-rose mb-4">Developing…</p>
      <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground mb-6">
        Sending your photographs...
      </h2>
      <p className="text-lg text-muted-foreground font-light leading-relaxed">
        Keep this page open. We are preparing to place you inside your venue for review.
      </p>
    </motion.div>
  );
}

function CoupleSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 flex flex-col">
      <Skeleton className="h-24 w-full mb-12 rounded-lg" />
      <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full">
        <Skeleton className="h-12 w-64 mb-6 rounded-md" />
        <Skeleton className="h-6 w-96 mb-16 rounded-md" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}

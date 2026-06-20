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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlimpseShell } from "@/components/layout/GlimpseShell";

function venueMediaUrl(objectKey: string | undefined, venueSlug: string): string {
  if (!objectKey) return "";
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTOS = 2;
const MIN_COUPLE_PHOTO_EDGE = 1024;
const MAX_COUPLE_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_COUPLE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COUPLE_REFERENCE_ROLES = ["Together", "Partner A", "Partner B"] as const;
const COUPLE_REFERENCE_GUIDANCE = [
  "Both faces visible",
  "Face-forward close view",
  "Face-forward close view",
] as const;

export default function CouplePage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
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
          description: "Upload images up to 8MB.",
          variant: "destructive",
        });
        continue;
      }
      const ok = await validatePhotoDimensions(file);
      if (!ok) {
        toast({
          title: "Photo too small",
          description: "Use clear photos at least 1024px wide and tall, with both faces visible and well lit.",
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
    if (selectedFiles.length < MIN_COUPLE_PHOTOS || !selectedStyleId || !coupleEmail.trim()) return;

    setStep(4);
    try {
      const objectKeys: string[] = [];
      for (const file of selectedFiles) {
        const result = await uploadFile(file);
        if (result) objectKeys.push(result.objectPath);
      }

      createSession.mutate(
        {
          slug: slug!,
          data: {
            couplePhotoKeys: objectKeys,
            styleId: selectedStyleId,
            coupleName: coupleName.trim() || undefined,
            coupleEmail: coupleEmail.trim().toLowerCase(),
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
      toast({ title: "Photos didn't upload", variant: "destructive" });
    }
  };

  if (venueQuery.isLoading) return <CoupleSkeleton />;

  if (venueQuery.isError || !venueQuery.data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <Heart className="h-12 w-12 text-primary/20 mb-4" />
        <h1 className="serif text-3xl mb-3">We couldn't find that venue</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          No venue answers to the code "{slug}". Double-check the code from
          your venue and try again.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs">
          <Button
            onClick={() => setLocation("/couple")}
            className="flex-1 bg-primary text-primary-foreground"
            data-testid="venue-notfound-home"
          >
            Enter another code
          </Button>
        </div>
      </div>
    );
  }

  const venue = venueQuery.data;

  // Guard rail: if the venue has too few photos, the AI has no reliable venue reference
  // against. Block the wizard entirely with a clear message instead of
  // letting couples spend time uploading photos for a session that will fail.
  if (!venue.media || venue.media.length < 5) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <Heart className="h-12 w-12 text-primary/30 mb-4" />
        <h1 className="serif text-3xl md:text-4xl mb-3">
          {venue.name} is still being prepared
        </h1>
        <p className="text-sm md:text-base text-muted-foreground mb-2 max-w-md">
          This venue needs at least five photographs before glimpse can compose
          your wedding gallery.
        </p>
        <p className="text-xs text-muted-foreground/70 mb-8 max-w-md">
          Ask your venue team to finish setting up glimpse by adding the required
          venue photographs before couples can begin.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-md">
          <Button
            onClick={() => setLocation("/couple")}
            className="flex-1 bg-primary text-primary-foreground"
            data-testid="venue-not-ready-browse"
          >
            Try another venue code
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative flex flex-col">
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
      className="fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute inset-0 z-0">
        {hasMedia ? (
          <AnimatePresence mode="wait">
            <motion.img
              key={currentPhoto}
              src={venueMediaUrl(venue.media[currentPhoto]?.objectKey, venue.slug)}
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5 }}
              className="w-full h-full object-cover"
            />
          </AnimatePresence>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-background via-muted/30 to-background" />
        )}
      </div>

      <div className="absolute inset-0 z-10 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

      <div className="absolute top-4 left-4 z-30 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-white/90 hover:text-white hover:bg-white/10 backdrop-blur"
          data-testid="venueshow-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-24 px-4 text-center">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="max-w-3xl"
        >
          <h1 className="serif text-5xl md:text-7xl font-bold mb-4 drop-shadow-2xl">
            {venue.name}
          </h1>
          {venue.tagline && (
            <p className="text-xl md:text-2xl text-secondary mb-6 font-light drop-shadow-lg italic">
              {venue.tagline}
            </p>
          )}
          {venue.description && (
            <p className="text-lg text-foreground/80 mb-12 max-w-2xl mx-auto drop-shadow-lg leading-relaxed">
              {venue.description}
            </p>
          )}
          <Button
            size="lg"
            onClick={onNext}
            className="rounded-full px-12 h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xl"
            data-testid="visualize-cta"
          >
            Step inside your wedding day
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
      className="flex-1 flex flex-col items-center justify-center p-4 max-w-4xl mx-auto w-full py-8 md:py-20 relative"
    >
      <div className="absolute top-4 left-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-muted-foreground hover:text-foreground"
          data-testid="upload-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-8 md:mb-12">
        <h2 className="serif text-3xl md:text-4xl mb-3">You and your partner</h2>
        <p className="text-muted-foreground font-light text-sm md:text-base">
          Upload in this order when possible: together, Partner A, then Partner B.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4 w-full text-xs">
        {COUPLE_REFERENCE_ROLES.map((role, index) => (
          <div
            key={role}
            className={`rounded-lg border px-3 py-2 ${
              previews.length > index
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <p className="font-medium">{index + 1}. {role}</p>
            <p className="mt-1">{COUPLE_REFERENCE_GUIDANCE[index]}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="w-full rounded-xl border-dashed border-2 border-border bg-card shadow-sm hover:border-primary/70 hover:bg-muted/40 active:border-primary transition-colors cursor-pointer flex flex-col items-center justify-center py-10 md:py-14 px-4 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card"
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
        <Camera className="h-10 w-10 md:h-12 md:w-12 text-primary mb-3" />
        <p className="text-base md:text-lg text-foreground font-medium">Tap to add photographs</p>
        <p className="text-xs md:text-sm text-muted-foreground mt-2 max-w-sm">
          Two or three JPG, PNG, or WebP photos under 8MB - well lit, distinct angles or expressions, at least 1024px wide and tall
        </p>
        <p className="mt-3 text-xs font-medium text-primary" data-testid="couple-photo-status">
          {uploadStatus}
        </p>
      </button>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-6 w-full">
          {previews.map((src, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative group aspect-square rounded-xl overflow-hidden border border-border"
            >
              <img src={src} className="w-full h-full object-cover" alt={`${COUPLE_REFERENCE_ROLES[i] ?? "Reference"} preview`} />
              <div className="absolute left-1.5 bottom-1.5 max-w-[calc(100%-0.75rem)] rounded-md bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground shadow">
                {COUPLE_REFERENCE_ROLES[i] ?? `Reference ${i + 1}`}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemovePhoto(i);
                }}
                disabled={isUploading}
                aria-label={`Remove photo ${i + 1}`}
                data-testid={`remove-couple-photo-${i}`}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-destructive shadow-md"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex gap-3 mt-8 w-full max-w-md">
        <Button variant="ghost" onClick={onBack} className="flex-1 min-h-[48px]">
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!hasEnoughReferences || isUploading}
          className="flex-[2] bg-primary text-primary-foreground min-h-[48px]"
          data-testid="choose-style-button"
        >
          <Images className="mr-2 h-4 w-4" />
          Set the scene
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
      className="flex-1 flex flex-col items-center p-4 max-w-5xl mx-auto w-full py-8 md:py-16 relative"
    >
      <div className="absolute top-4 left-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          disabled={isSubmitting}
          className="text-muted-foreground hover:text-foreground"
          data-testid="style-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-8 md:mb-12">
        <h2 className="serif text-3xl md:text-4xl mb-3">Set the scene</h2>
        <p className="text-muted-foreground font-light text-sm md:text-base max-w-xl mx-auto">
          Choose the editorial direction for your venue-branded glimpse gallery.
        </p>
      </div>

      <div className="text-center mb-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Style</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {styles.map((style) => {
            const isSelected = selectedStyleId === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => onSelect(style.id)}
                disabled={isSubmitting}
                data-testid={`style-option-${style.id}`}
                className={`glass relative text-left rounded-xl p-5 md:p-6 border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-primary shadow-[0_0_0_2px_rgba(255,255,255,0.05)] bg-primary/10"
                    : "border-border/40 hover:border-secondary/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="serif text-xl md:text-2xl mb-2 leading-tight">{style.name}</h3>
                    <p className="text-sm text-muted-foreground font-light leading-relaxed">
                      {style.description}
                    </p>
                  </div>
                  <div
                    aria-hidden
                    className={`shrink-0 h-7 w-7 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border/60 text-transparent"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-10 w-full max-w-2xl space-y-4">
        <div className="glass rounded-xl p-5 border border-border/40">
          <label
            htmlFor="couple-email"
            className="text-xs uppercase tracking-widest font-medium text-foreground/80 flex items-center gap-2"
          >
            <Mail className="h-3.5 w-3.5 text-primary" /> Your email
          </label>
          <p className="text-xs text-muted-foreground font-light mt-1 mb-3">
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
            data-testid="style-couple-email"
            className="w-full bg-muted/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="glass rounded-xl p-5 border border-border/40">
          <label
            htmlFor="couple-name-optional"
            className="text-xs uppercase tracking-widest font-medium text-foreground/80"
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
            maxLength={80}
            data-testid="style-couple-name"
            className="w-full mt-3 bg-muted/20 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>

        <div className="glass rounded-xl p-5 border border-border/40">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-primary" />
          <p className="text-xs uppercase tracking-widest font-medium text-foreground/80">
              Gallery Delivery
            </p>
          </div>
          <div className="text-left rounded-lg p-4 border border-primary bg-primary/10">
            <div className="serif text-lg leading-tight mb-1">4 portraits + motion reel</div>
            <div className="text-xs text-muted-foreground font-light leading-snug">
              Editorial portraits anchored to this venue, compiled into a gentle branded reel. Usually ready in a few minutes.
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6 w-full max-w-md">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isSubmitting}
          className="flex-1 min-h-[48px]"
          data-testid="style-back-button"
        >
          Back
        </Button>
        <Button
          onClick={onSubmit}
          disabled={!selectedStyleId || !coupleEmail.trim() || isSubmitting}
          className="flex-[2] bg-primary text-primary-foreground min-h-[48px]"
          data-testid="generate-button"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 animate-spin" />
          ) : (
            <Images className="mr-2 h-4 w-4" />
          )}
          Compose my gallery
        </Button>
      </div>
    </motion.div>
  );
}

function SubmittingStep() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col items-center justify-center p-4 text-center"
    >
      <Loader2 className="h-16 w-16 animate-spin text-primary mb-8" />
      <h2 className="serif text-3xl mb-4 italic">Sending your photographs...</h2>
      <p className="text-muted-foreground font-light max-w-md">
        Keep this page open - we are placing you inside your venue for review.
      </p>
    </motion.div>
  );
}

function CoupleSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 flex flex-col">
      <Skeleton className="h-20 w-full mb-8" />
      <div className="flex-1 flex flex-col items-center justify-center">
        <Skeleton className="h-12 w-64 mb-4" />
        <Skeleton className="h-6 w-96 mb-12" />
        <Skeleton className="h-64 w-full max-w-4xl" />
      </div>
    </div>
  );
}


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
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GlimpseShell } from "@/components/layout/GlimpseShell";

function venueMediaUrl(objectKey: string | undefined, venueSlug: string): string {
  if (!objectKey) return "";
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTOS = 1;
const MIN_COUPLE_PHOTO_EDGE = 512;
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
          description: "Use clear photos at least 512px wide and tall, with both faces visible and well lit.",
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
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center font-sans selection:bg-gold selection:text-white">
        <Heart className="h-12 w-12 text-gray-200 mb-6" />
        <h1 className="font-playfair text-4xl mb-4 text-[#111111]">We couldn't find that venue</h1>
        <p className="text-lg text-gray-500 mb-8 max-w-md font-light">
          No venue answers to the code "{slug}". Double-check the code from
          your venue and try again.
        </p>
        <Button
          onClick={() => setLocation("/couple")}
          variant="gold"
          className="rounded-full px-8 py-6 text-base font-medium shadow-lg shadow-gold/20"
          data-testid="venue-notfound-home"
        >
          Enter another code
        </Button>
      </div>
    );
  }

  const venue = venueQuery.data;

  // Guard rail: if the venue has too few photos, the AI has no reliable venue reference
  if (!venue.media || venue.media.length < 5) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center font-sans selection:bg-gold selection:text-white">
        <Heart className="h-12 w-12 text-gold/40 mb-6" />
        <h1 className="font-playfair text-4xl md:text-5xl mb-4 text-[#111111]">
          {venue.name} is still being prepared
        </h1>
        <p className="text-lg text-gray-500 mb-3 max-w-md font-light">
          This venue needs at least one photograph before glimpse can compose
          your wedding gallery.
        </p>
        <p className="text-sm text-gray-400 mb-10 max-w-md">
          Ask your venue team to finish setting up glimpse by adding the required
          venue photographs before couples can begin.
        </p>
        <Button
          onClick={() => setLocation("/couple")}
          variant="gold"
          className="rounded-full px-8 py-6 text-base font-medium shadow-lg shadow-gold/20"
          data-testid="venue-not-ready-browse"
        >
          Try another venue code
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans relative flex flex-col selection:bg-gold selection:text-white overflow-x-hidden">
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
      className="fixed inset-0 z-0 overflow-hidden bg-black"
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
          <div className="w-full h-full bg-gray-900" />
        )}
      </div>

      <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#111111]/90 via-[#111111]/30 to-black/40" />

      <div className="absolute top-6 left-6 z-30 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/couple")}
          className="text-white/80 hover:text-white hover:bg-white/20 backdrop-blur rounded-full px-5 py-2 font-medium"
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
          <div className="mb-6 mx-auto inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/40 backdrop-blur-md px-4 py-1.5 text-xs font-semibold tracking-wide text-white">
            <Sparkles className="w-3.5 h-3.5 text-gold" />
            <span>Interactive Preview</span>
          </div>

          <h1 className="font-playfair text-5xl md:text-7xl font-bold mb-6 text-white tracking-tight drop-shadow-2xl">
            {venue.name}
          </h1>
          
          {venue.tagline && (
            <p className="text-xl md:text-2xl text-gold mb-8 font-light drop-shadow-lg italic font-playfair">
              {venue.tagline}
            </p>
          )}
          
          {venue.description && (
            <p className="text-lg md:text-xl text-gray-200 mb-12 max-w-2xl mx-auto drop-shadow-lg leading-relaxed font-light">
              {venue.description}
            </p>
          )}
          
          <Button
            size="lg"
            variant="gold"
            onClick={onNext}
            className="rounded-full px-10 py-7 text-lg shadow-2xl shadow-gold/20 font-medium group"
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
          className="text-gray-500 hover:text-[#111111] hover:bg-gray-50 rounded-full font-medium"
          data-testid="upload-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-gold">
          Step 01
        </div>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-[#111111] mb-4">
          You and your partner
        </h2>
        <p className="text-gray-500 font-light text-lg max-w-lg mx-auto">
          Upload clear, well-lit photos in this order: together, Partner A, then Partner B.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 w-full">
        {COUPLE_REFERENCE_ROLES.map((role, index) => {
          const isFilled = previews.length > index;
          return (
            <div
              key={role}
              className={`rounded-3xl border p-6 transition-all duration-300 ${
                isFilled
                  ? "border-gold/30 bg-[#fdfbf7]"
                  : "border-gray-100 bg-white shadow-sm"
              }`}
            >
              <p className={`font-bold mb-1 ${isFilled ? "text-[#111111]" : "text-gray-400"}`}>
                {index + 1}. {role}
              </p>
              <p className={`font-light text-sm ${isFilled ? "text-gray-600" : "text-gray-400"}`}>
                {COUPLE_REFERENCE_GUIDANCE[index]}
              </p>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="w-full rounded-[2rem] border-dashed border-2 border-gray-200 bg-gray-50/50 shadow-sm hover:border-gold/50 hover:bg-[#fdfbf7] active:border-gold transition-colors cursor-pointer flex flex-col items-center justify-center py-12 md:py-16 px-6 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-gray-200 disabled:hover:bg-gray-50/50"
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
        <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-6 shadow-sm border border-gray-100 text-gold">
          <Camera className="h-7 w-7" />
        </div>
        <p className="text-xl text-[#111111] font-bold mb-3">Tap to add photographs</p>
        <p className="text-base text-gray-500 font-light max-w-md mx-auto">
          One to three JPG, PNG, or WebP photos under 8MB — distinct angles or expressions, at least 512px wide.
        </p>
        <p className="mt-6 text-sm font-semibold tracking-wide text-gold uppercase" data-testid="couple-photo-status">
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
              className="relative group aspect-square rounded-3xl overflow-hidden border border-gray-100 shadow-sm"
            >
              <img src={src} className="w-full h-full object-cover" alt={`${COUPLE_REFERENCE_ROLES[i] ?? "Reference"} preview`} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute left-4 bottom-4 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-semibold text-[#111111] shadow-sm">
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
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:bg-red-500 hover:scale-110 shadow-sm backdrop-blur-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 mt-12 w-full max-w-lg mx-auto">
        <Button variant="ghost" onClick={onBack} className="w-full sm:w-1/3 rounded-full py-6 text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-[#111111]">
          Back
        </Button>
        <Button
          variant="gold"
          onClick={onContinue}
          disabled={!hasEnoughReferences || isUploading}
          className="w-full sm:w-2/3 rounded-full py-6 text-base font-medium shadow-lg shadow-gold/20"
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
          className="text-gray-500 hover:text-[#111111] hover:bg-gray-50 rounded-full font-medium"
          data-testid="style-home"
        >
          <Home className="mr-2 h-4 w-4" /> Home
        </Button>
      </div>

      <div className="text-center mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-gold">
          Step 02
        </div>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-[#111111] mb-4">Set the scene</h2>
        <p className="text-gray-500 font-light text-lg max-w-xl mx-auto">
          Choose the editorial direction for your venue-branded glimpse gallery.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl mx-auto">
          {styles.map((style) => {
            const isSelected = selectedStyleId === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => onSelect(style.id)}
                disabled={isSubmitting}
                data-testid={`style-option-${style.id}`}
                className={`relative text-left rounded-3xl p-6 md:p-8 border transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-gold bg-[#fdfbf7] shadow-lg shadow-gold/10"
                    : "border-gray-100 bg-white hover:border-gray-300 hover:bg-gray-50/50 shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-xl md:text-2xl mb-2 tracking-tight text-[#111111]">{style.name}</h3>
                    <p className="text-sm md:text-base text-gray-500 font-light leading-relaxed">
                      {style.description}
                    </p>
                  </div>
                  <div
                    aria-hidden
                    className={`shrink-0 h-6 w-6 rounded-full border flex items-center justify-center transition-colors mt-1 ${
                      isSelected
                        ? "bg-gold border-gold text-white"
                        : "border-gray-300 text-transparent"
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

      <div className="mt-16 w-full max-w-2xl space-y-6">
        <div className="rounded-3xl bg-white border border-gray-100 p-6 md:p-8 shadow-sm">
          <label
            htmlFor="couple-email"
            className="text-xs font-semibold tracking-widest uppercase text-gold flex items-center gap-2 mb-2"
          >
            <Mail className="h-4 w-4" /> Your email
          </label>
          <p className="text-sm text-gray-500 font-light mb-4">
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
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 md:py-4 text-base text-[#111111] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold disabled:opacity-50 transition-all placeholder:text-gray-400"
          />
        </div>

        <div className="rounded-3xl bg-white border border-gray-100 p-6 md:p-8 shadow-sm">
          <label
            htmlFor="couple-name-optional"
            className="text-xs font-semibold tracking-widest uppercase text-gold mb-4 block"
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
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 md:py-4 text-base text-[#111111] focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold disabled:opacity-50 transition-all placeholder:text-gray-400"
          />
        </div>

        <div className="rounded-3xl bg-[#fdfbf7] border border-[#f0e6d2] p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-gold" />
            <p className="text-xs font-semibold tracking-widest uppercase text-gold">
              Gallery Delivery
            </p>
          </div>
          <div className="font-playfair text-xl md:text-2xl font-bold text-[#111111] mb-2">4 portraits + motion reel</div>
          <div className="text-base text-gray-600 font-light leading-relaxed">
            Editorial portraits anchored to this venue, compiled into a gentle branded reel. Usually ready in a few minutes.
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mt-12 w-full max-w-lg mx-auto">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isSubmitting}
          className="w-full sm:w-1/3 rounded-full py-6 text-base font-medium text-gray-600 hover:bg-gray-50 hover:text-[#111111]"
          data-testid="style-back-button"
        >
          Back
        </Button>
        <Button
          variant="gold"
          onClick={onSubmit}
          disabled={!selectedStyleId || !coupleEmail.trim() || isSubmitting}
          className="w-full sm:w-2/3 rounded-full py-6 text-base font-medium shadow-lg shadow-gold/20"
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
      <div className="w-20 h-20 rounded-full bg-[#fdfbf7] border border-[#f0e6d2] flex items-center justify-center mb-8 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
      <h2 className="font-playfair text-4xl md:text-5xl font-bold text-[#111111] mb-6">
        Sending your photographs...
      </h2>
      <p className="text-lg text-gray-500 font-light leading-relaxed">
        Keep this page open. We are preparing to place you inside your venue for review.
      </p>
    </motion.div>
  );
}

function CoupleSkeleton() {
  return (
    <div className="min-h-screen bg-white p-6 flex flex-col">
      <Skeleton className="h-24 w-full mb-12 rounded-3xl" />
      <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full">
        <Skeleton className="h-12 w-64 mb-6 rounded-full" />
        <Skeleton className="h-6 w-96 mb-16 rounded-full" />
        <Skeleton className="h-80 w-full rounded-[2.5rem]" />
      </div>
    </div>
  );
}

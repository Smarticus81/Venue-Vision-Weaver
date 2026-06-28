import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAddVenueMedia,
  useCreateSession,
  useDeleteVenueMedia,
  useGetVenueDashboard,
  useListVenueMedia,
  useUpdateVenue,
  getGetVenueDashboardQueryKey,
  getListVenueMediaQueryKey,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  Image as ImageIcon,
  ImageUp,
  Loader2,
  LogOut,
  Mail,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const MIN_VENUE_PHOTOS = 5;
const MIN_COUPLE_PHOTOS = 2;
const MAX_COUPLE_PHOTOS = 3;
const COVERAGE_OPTIONS = [
  { value: "exterior", label: "Exterior" },
  { value: "ceremony", label: "Ceremony" },
  { value: "reception", label: "Reception" },
  { value: "detail", label: "Detail" },
  { value: "natural_light", label: "Natural light" },
] as const;

type Coverage = (typeof COVERAGE_OPTIONS)[number]["value"];

interface OwnerSession {
  ownerEmail: string;
  venues: Array<{ id: number; name: string; slug: string }>;
}

function venueReferenceUrl(objectKey: string, venueSlug: string): string {
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

function ownerAssetUrl(objectKey: string): string {
  return `/api/storage${objectKey}`;
}

export default function VenueOwnerPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coupleFileInputRef = useRef<HTMLInputElement>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [ownerSession, setOwnerSession] = useState<OwnerSession | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({
    name: "",
    contactEmail: "",
    bookingUrl: "",
  });
  const [sendingSessionId, setSendingSessionId] = useState<number | null>(null);
  const [coupleName, setCoupleName] = useState("");
  const [coupleEmail, setCoupleEmail] = useState("");
  const [coupleFiles, setCoupleFiles] = useState<File[]>([]);
  const [couplePreviews, setCouplePreviews] = useState<string[]>([]);
  const [isStartingGallery, setIsStartingGallery] = useState(false);
  const couplePreviewsRef = useRef<string[]>([]);

  useEffect(() => {
    fetch("/api/owners/session")
      .then(async (res) => {
        if (!res.ok) throw new Error("Not signed in");
        return (await res.json()) as OwnerSession;
      })
      .then((session) => {
        setOwnerSession(session);
        const firstVenue = session.venues[0];
        if (!firstVenue) {
          setLocation("/create-venue");
          return;
        }
        setSelectedSlug(firstVenue.slug);
      })
      .catch(() => setLocation("/login"))
      .finally(() => setAuthChecked(true));
  }, [setLocation]);

  const dashboard = useGetVenueDashboard(selectedSlug, {
    query: {
      enabled: Boolean(selectedSlug),
      queryKey: getGetVenueDashboardQueryKey(selectedSlug),
    },
  });
  const mediaQuery = useListVenueMedia(selectedSlug, {
    query: {
      enabled: Boolean(selectedSlug),
      queryKey: getListVenueMediaQueryKey(selectedSlug),
    },
    request: {},
  });
  const addMedia = useAddVenueMedia({ request: {} });
  const deleteMedia = useDeleteVenueMedia({ request: {} });
  const updateVenue = useUpdateVenue({ request: {} });
  const createSession = useCreateSession();
  const { uploadFile: uploadVenueFile, isUploading: isUploadingVenue, progress: venueUploadProgress } = useUpload({
    purpose: "venue",
    venueSlug: selectedSlug,
    onError: (err) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const { uploadFile: uploadCoupleFile, isUploading: isUploadingCouple } = useUpload({
    purpose: "couple",
    venueSlug: selectedSlug,
    onError: (err) => {
      toast({
        title: "Couple photo failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const venue = dashboard.data?.venue;
  const sessions = dashboard.data?.sessions ?? [];
  const media = mediaQuery.data?.media ?? [];
  const presentCoverage = useMemo(
    () => new Set(media.map((item) => item.coverage)),
    [media],
  );
  const missingCoverage = COVERAGE_OPTIONS.filter((option) => !presentCoverage.has(option.value));
  const nextCoverage: Coverage = missingCoverage[0]?.value ?? "detail";
  const readySessions = sessions.filter((session) => session.status === "ready").length;
  const processingSessions = sessions.filter(
    (session) => session.status === "processing" || session.status === "pending",
  ).length;
  const venueReady = media.length >= MIN_VENUE_PHOTOS && missingCoverage.length === 0;

  useEffect(() => {
    if (!venue) return;
    setProfile({
      name: venue.name ?? "",
      contactEmail: venue.contactEmail ?? venue.ownerEmail ?? "",
      bookingUrl: venue.bookingUrl ?? "",
    });
  }, [venue?.id]);

  useEffect(() => {
    couplePreviewsRef.current = couplePreviews;
  }, [couplePreviews]);

  useEffect(() => {
    return () => {
      couplePreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedSlug) return;

    const result = await uploadVenueFile(file);
    if (!result) return;

    addMedia.mutate(
      {
        slug: selectedSlug,
        data: {
          objectKey: result.objectPath,
          coverage: nextCoverage,
          displayOrder: media.length,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Venue photo added" });
          void mediaQuery.refetch();
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          toast({
            title: "Photo was not saved",
            description: err.data?.error ?? "Try another venue image.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleDeleteMedia = (mediaId: number) => {
    if (!selectedSlug) return;
    deleteMedia.mutate(
      { slug: selectedSlug, mediaId },
      {
        onSuccess: () => {
          toast({ title: "Photo removed" });
          void mediaQuery.refetch();
        },
      },
    );
  };

  const handleSaveProfile = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSlug || !venue) return;
    setSaving(true);
    updateVenue.mutate(
      {
        slug: selectedSlug,
        data: {
          name: profile.name.trim(),
          contactEmail: profile.contactEmail.trim().toLowerCase() || null,
          bookingUrl: profile.bookingUrl.trim() || null,
        } as never,
      },
      {
        onSuccess: () => {
          toast({ title: "Venue details saved" });
          void queryClient.invalidateQueries({
            queryKey: getGetVenueDashboardQueryKey(selectedSlug),
          });
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          toast({
            title: "Save failed",
            description: err.data?.error ?? "Try again.",
            variant: "destructive",
          });
        },
        onSettled: () => setSaving(false),
      },
    );
  };

  const handleSendGallery = async (sessionId: number, coupleEmail?: string | null) => {
    if (!coupleEmail) {
      toast({
        title: "No email on this session",
        description: "A recipient email is required before sending.",
        variant: "destructive",
      });
      return;
    }
    setSendingSessionId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: coupleEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send gallery.");
      toast({
        title: "Gallery emailed",
        description: `Sent to ${coupleEmail}.`,
      });
    } catch (err) {
      toast({
        title: "Email failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSendingSessionId(null);
    }
  };

  const handleViewGallery = (shareToken?: string | null) => {
    if (!shareToken) {
      toast({
        title: "Gallery link is not ready",
        description: "This session does not have a private gallery link yet.",
        variant: "destructive",
      });
      return;
    }
    window.open(`/v/${shareToken}`, "_blank", "noopener,noreferrer");
  };

  const handleCoupleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const availableSlots = MAX_COUPLE_PHOTOS - coupleFiles.length;
    if (availableSlots <= 0) {
      toast({ title: "Three couple photos is the limit" });
      return;
    }

    const accepted = files
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      .slice(0, availableSlots);
    if (accepted.length === 0) {
      toast({
        title: "Use JPG, PNG, or WebP photos",
        variant: "destructive",
      });
      return;
    }

    setCoupleFiles((prev) => [...prev, ...accepted].slice(0, MAX_COUPLE_PHOTOS));
    setCouplePreviews((prev) => [
      ...prev,
      ...accepted.map((file) => URL.createObjectURL(file)),
    ].slice(0, MAX_COUPLE_PHOTOS));
  };

  const removeCoupleFile = (index: number) => {
    setCoupleFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
    setCouplePreviews((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed);
      return prev.filter((_, previewIndex) => previewIndex !== index);
    });
  };

  const resetCoupleIntake = () => {
    couplePreviews.forEach((url) => URL.revokeObjectURL(url));
    setCoupleFiles([]);
    setCouplePreviews([]);
    setCoupleName("");
    setCoupleEmail("");
  };

  const handleStartGallery = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSlug) return;
    if (!venueReady) {
      toast({
        title: "Finish venue photos first",
        description: "Add the required venue views before starting couple galleries.",
        variant: "destructive",
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coupleEmail.trim())) {
      toast({
        title: "Couple email required",
        description: "This is where Glimpse sends the finished gallery.",
        variant: "destructive",
      });
      return;
    }
    if (coupleFiles.length < MIN_COUPLE_PHOTOS) {
      toast({
        title: "Add at least two couple photos",
        description: "Use clear, well-lit photos for better likeness.",
        variant: "destructive",
      });
      return;
    }

    setIsStartingGallery(true);
    try {
      const couplePhotoKeys: string[] = [];
      for (const file of coupleFiles) {
        const uploaded = await uploadCoupleFile(file);
        if (uploaded) couplePhotoKeys.push(uploaded.objectPath);
      }
      if (couplePhotoKeys.length < MIN_COUPLE_PHOTOS) {
        throw new Error("At least two couple photos must upload successfully.");
      }

      createSession.mutate(
        {
          slug: selectedSlug,
          data: {
            coupleName: coupleName.trim() || undefined,
            coupleEmail: coupleEmail.trim().toLowerCase(),
            couplePhotoKeys,
          },
        },
        {
          onSuccess: () => {
            toast({
              title: "Gallery started",
              description: "Glimpse will email the couple when it is ready.",
            });
            resetCoupleIntake();
            void dashboard.refetch();
          },
          onError: (err: ErrorType<ErrorEnvelope>) => {
            toast({
              title: "Could not start gallery",
              description: err.data?.error ?? "Try again.",
              variant: "destructive",
            });
          },
          onSettled: () => setIsStartingGallery(false),
        },
      );
    } catch (err) {
      setIsStartingGallery(false);
      toast({
        title: "Could not start gallery",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleLogout = async () => {
    await fetch("/api/owners/logout", { method: "POST" });
    setLocation("/login");
  };

  if (!authChecked || dashboard.isLoading) {
    return (
      <div className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#f6eef5_46%,#edf8f5_100%)] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-[#111318]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#f6eef5_46%,#edf8f5_100%)] text-[#111318]">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_10%,rgba(255,255,255,0.95),transparent_26%),radial-gradient(circle_at_82%_16%,rgba(203,235,255,0.72),transparent_29%),radial-gradient(circle_at_56%_88%,rgba(255,230,238,0.72),transparent_30%)]" />

      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/48 backdrop-blur-3xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111318] text-white shadow-lg">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-4">glimpse</p>
              <p className="hidden text-xs text-foreground/48 sm:block">
                {ownerSession?.ownerEmail}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ownerSession && ownerSession.venues.length > 1 ? (
              <select
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="h-9 rounded-md border border-white/70 bg-white/55 px-3 text-sm outline-none backdrop-blur-xl"
                aria-label="Switch venue"
              >
                {ownerSession.venues.map((ownedVenue) => (
                  <option key={ownedVenue.id} value={ownedVenue.slug}>
                    {ownedVenue.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-foreground/62 hover:text-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.12),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-foreground/45">
                  Venue dashboard
                </p>
                <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">
                  {venue?.name ?? "Your venue"}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/58">
                  Keep the venue ready and send finished galleries to couples by email.
                </p>
              </div>
              <Badge className={venueReady ? "bg-emerald-500 text-white" : "bg-amber-400 text-[#111318]"}>
                {venueReady ? "Ready for tours" : "Needs photos"}
              </Badge>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-4">
              <Metric label="Credits" value={venue?.creditsBalance ?? 0} />
              <Metric label="Ready" value={readySessions} />
              <Metric label="Processing" value={processingSessions} />
              <Metric label="Photos" value={`${media.length}/${MIN_VENUE_PHOTOS}`} />
            </div>
          </motion.div>

          <motion.form
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            onSubmit={handleSaveProfile}
            className="rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.1),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl"
          >
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-sky-500" />
              <h2 className="font-semibold">Conversion details</h2>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="venue-name">Venue name</Label>
                <Input
                  id="venue-name"
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  className="border-white/80 bg-white/62"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Inquiry email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={profile.contactEmail}
                  onChange={(e) => setProfile((prev) => ({ ...prev, contactEmail: e.target.value }))}
                  className="border-white/80 bg-white/62"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-url">Tour booking link</Label>
                <Input
                  id="booking-url"
                  value={profile.bookingUrl}
                  onChange={(e) => setProfile((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                  className="border-white/80 bg-white/62"
                  placeholder="https://yourvenue.com/tours"
                />
              </div>
              <Button type="submit" disabled={saving} className="w-full bg-[#111318] text-white hover:bg-[#252932]">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </div>
          </motion.form>
        </section>

        <section className="mt-4 rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.1),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-foreground/45">
                New couple
              </p>
              <h2 className="text-2xl font-semibold tracking-normal">Start a gallery from the tour</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/58">
                Add the couple's email and reference photos. Glimpse generates the gallery and emails their private link automatically.
              </p>
            </div>
            <Badge className={venueReady ? "bg-emerald-500 text-white" : "bg-amber-400 text-[#111318]"}>
              {venueReady ? "Ready" : "Venue setup needed"}
            </Badge>
          </div>

          <form onSubmit={handleStartGallery} className="grid gap-4 lg:grid-cols-[340px_1fr_auto] lg:items-end">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="couple-name">Names</Label>
                <Input
                  id="couple-name"
                  value={coupleName}
                  onChange={(e) => setCoupleName(e.target.value)}
                  className="border-white/80 bg-white/62"
                  placeholder="Avery & Jordan"
                  maxLength={80}
                  data-testid="owner-couple-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="couple-email">Email</Label>
                <Input
                  id="couple-email"
                  type="email"
                  value={coupleEmail}
                  onChange={(e) => setCoupleEmail(e.target.value)}
                  className="border-white/80 bg-white/62"
                  placeholder="bride@example.com"
                  data-testid="owner-couple-email"
                />
              </div>
            </div>

            <div>
              <input
                ref={coupleFileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleCoupleFiles}
                data-testid="owner-couple-photo-input"
              />
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((slot) => {
                  const preview = couplePreviews[slot];
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => {
                        if (!preview) coupleFileInputRef.current?.click();
                      }}
                      className="relative aspect-square overflow-hidden rounded-lg border border-white/75 bg-white/50 text-foreground/48 transition hover:bg-white/70"
                      aria-label={preview ? `Couple photo ${slot + 1}` : "Add couple photo"}
                    >
                      {preview ? (
                        <>
                          <img src={preview} alt={`Couple reference ${slot + 1}`} className="h-full w-full object-cover" />
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCoupleFile(slot);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                removeCoupleFile(slot);
                              }
                            }}
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/62 text-white"
                            aria-label="Remove couple photo"
                          >
                            <X className="h-4 w-4" />
                          </span>
                        </>
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs">
                          <ImageUp className="h-5 w-5" />
                          Photo {slot + 1}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => coupleFileInputRef.current?.click()}
                disabled={coupleFiles.length >= MAX_COUPLE_PHOTOS}
                className="mt-2 w-full text-foreground/62 hover:text-foreground"
              >
                <Upload className="mr-2 h-4 w-4" />
                Add couple photos
              </Button>
            </div>

            <Button
              type="submit"
              disabled={
                !venueReady ||
                isStartingGallery ||
                isUploadingCouple ||
                createSession.isPending ||
                coupleFiles.length < MIN_COUPLE_PHOTOS
              }
              className="h-12 bg-[#111318] text-white hover:bg-[#252932]"
              data-testid="owner-start-gallery"
            >
              {isStartingGallery || isUploadingCouple || createSession.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Start gallery
            </Button>
          </form>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.1),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Venue photo readiness</h2>
                <p className="mt-1 text-sm text-foreground/55">
                  {venueReady
                    ? "The venue has the coverage needed for gallery generation."
                    : "Add the missing room views before tours use Glimpse."}
                </p>
              </div>
              <ImageUp className="h-5 w-5 text-sky-500" />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2">
              {COVERAGE_OPTIONS.map((option) => {
                const complete = presentCoverage.has(option.value);
                return (
                  <div
                    key={option.value}
                    className={`rounded-lg border px-3 py-3 text-sm ${
                      complete
                        ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
                        : "border-white/75 bg-white/54 text-foreground/52"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md ${complete ? "bg-emerald-500 text-white" : "bg-white/75"}`}>
                        {complete ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      {option.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleUpload}
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingVenue || addMedia.isPending}
              className="mt-5 h-12 w-full bg-[#111318] text-white hover:bg-[#252932]"
            >
              {isUploadingVenue || addMedia.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isUploadingVenue ? `Uploading ${venueUploadProgress}%` : "Add venue photo"}
            </Button>
          </div>

          <div className="rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.1),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Venue images</h2>
                <p className="mt-1 text-sm text-foreground/55">Real spaces power the gallery output.</p>
              </div>
              <Badge variant="secondary" className="bg-white/70">
                {media.length} photos
              </Badge>
            </div>

            {media.length === 0 ? (
              <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-white/80 bg-white/38">
                <div className="text-center text-foreground/50">
                  <ImageIcon className="mx-auto mb-3 h-8 w-8" />
                  <p className="text-sm">No venue photos yet.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {media.map((item) => (
                  <div key={item.id} className="group relative aspect-square overflow-hidden rounded-lg bg-white/50">
                    <img
                      src={venueReferenceUrl(item.objectKey, selectedSlug)}
                      alt="Venue reference"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(item.id)}
                      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-black/62 text-white opacity-0 transition group-hover:opacity-100"
                      aria-label="Delete venue photo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_24px_80px_rgba(31,41,55,0.1),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Couple galleries</h2>
              <p className="mt-1 text-sm text-foreground/55">
                Finished galleries are sent by email to the bride or couple.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/70 bg-white/40">
            {sessions.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center text-center text-sm text-foreground/52">
                No couple galleries yet.
              </div>
            ) : (
              <div className="divide-y divide-white/70">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="grid gap-3 p-4 md:grid-cols-[64px_1fr_auto] md:items-center"
                  >
                    <div className="h-16 w-16 overflow-hidden rounded-lg bg-white/65">
                      {session.thumbnailObjectKey ? (
                        <img
                          src={ownerAssetUrl(session.thumbnailObjectKey)}
                          alt="Gallery"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-foreground/35">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{session.coupleName || "Couple gallery"}</p>
                        <StatusBadge status={session.status} />
                      </div>
                      <p className="mt-1 text-sm text-foreground/55">
                        {session.coupleEmail || "No email"} ·{" "}
                        {new Date(session.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!session.shareToken}
                        onClick={() => handleViewGallery(session.shareToken)}
                        className="border-white/80 bg-white/55"
                        data-testid={`view-gallery-${session.id}`}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View gallery
                      </Button>
                      <Button
                        type="button"
                        disabled={
                          session.status !== "ready" ||
                          !session.coupleEmail ||
                          sendingSessionId === session.id
                        }
                        onClick={() => handleSendGallery(session.id, session.coupleEmail)}
                        className="bg-[#111318] text-white hover:bg-[#252932]"
                      >
                        {sendingSessionId === session.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Mail className="mr-2 h-4 w-4" />
                        )}
                        Email gallery <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/55 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-foreground/42">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "ready"
      ? "bg-emerald-500 text-white"
      : status === "failed"
        ? "bg-rose-500 text-white"
        : "bg-amber-400 text-[#111318]";
  return <Badge className={classes}>{status}</Badge>;
}

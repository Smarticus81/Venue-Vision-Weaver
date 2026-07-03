import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAddVenueMedia,
  useCreateSession,
  useDeleteSession,
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
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

const MIN_VENUE_PHOTOS = 1;
const MIN_COUPLE_PHOTOS = 1;
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

function normalizeStorageObjectPath(objectKey: string): string {
  const raw = objectKey.trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("/api/storage/")) {
    return raw;
  }
  const uploadPath = raw.match(/uploads\/([^/?#]+)/)?.[1];
  if (uploadPath) {
    return `/api/storage/objects/uploads/${uploadPath}`;
  }
  if (raw.startsWith("/objects/")) {
    return `/api/storage${raw}`;
  }
  if (raw.startsWith("objects/")) {
    return `/api/storage/${raw}`;
  }
  return `/api/storage/objects/${raw.replace(/^\/+/, "")}`;
}

function withQueryParam(url: string, key: string, value: string): string {
  if (!url || !value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function venueReferenceUrl(objectKey: string, venueSlug: string): string {
  return withQueryParam(normalizeStorageObjectPath(objectKey), "venueSlug", venueSlug);
}

function ownerAssetUrl(objectKey: string): string {
  return normalizeStorageObjectPath(objectKey);
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
  const deleteSession = useDeleteSession();
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
  const lastCoupleUploadError = useRef<string | null>(null);
  const { uploadFile: uploadCoupleFile, isUploading: isUploadingCouple } = useUpload({
    purpose: "couple",
    venueSlug: selectedSlug,
    onError: (err) => {
      lastCoupleUploadError.current = err.message;
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
  const venueReady = media.length >= MIN_VENUE_PHOTOS;

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

  const handleDeleteSession = (sessionId: number, coupleName?: string | null) => {
    const confirmed = window.confirm(
      `Delete ${coupleName || "this prospect gallery"}? This permanently removes the gallery, its photos, and its share link.`,
    );
    if (!confirmed) return;
    deleteSession.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          toast({ title: "Gallery deleted" });
          void queryClient.invalidateQueries({
            queryKey: getGetVenueDashboardQueryKey(selectedSlug),
          });
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          toast({
            title: "Delete failed",
            description: err.data?.error ?? "Try again.",
            variant: "destructive",
          });
        },
      },
    );
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
        title: "Add at least one couple photo",
        description: "Use clear, well-lit photos for better likeness.",
        variant: "destructive",
      });
      return;
    }

    setIsStartingGallery(true);
    try {
      lastCoupleUploadError.current = null;
      const couplePhotoKeys: string[] = [];
      for (const file of coupleFiles) {
        const uploaded = await uploadCoupleFile(file);
        if (uploaded) couplePhotoKeys.push(uploaded.objectPath);
      }
      if (couplePhotoKeys.length < MIN_COUPLE_PHOTOS) {
        throw new Error(
          lastCoupleUploadError.current ?? "At least one couple photo must upload successfully.",
        );
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 selection:bg-gold selection:text-white">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <GlimpseLogo className="h-12" />
            <div className="hidden h-4 w-px bg-border sm:block"></div>
            <p className="hidden text-xs font-medium text-muted-foreground sm:block">
              {ownerSession?.ownerEmail}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ownerSession && ownerSession.venues.length > 1 ? (
              <select
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="h-9 rounded-full border border-border bg-background px-4 text-sm font-medium outline-none shadow-sm focus:border-gold focus:ring-1 focus:ring-gold"
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
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12 space-y-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="glimpse-card p-6 md:p-8 flex flex-col justify-between"
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold">
                  Venue dashboard
                </p>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
                  {venue?.name ?? "Your venue"}
                </h1>
                <p className="mt-3 max-w-xl text-base font-light leading-relaxed text-muted-foreground">
                  Manage branded, true-to-space preview galleries that help prospects
                  visualize their event and move toward an inquiry.
                </p>
              </div>
              <Badge className={venueReady ? "inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#8a7340] shadow-sm" : "inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-amber-700 shadow-sm"}>
                {venueReady ? "Ready for tours" : "Needs photos"}
              </Badge>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-4">
              <Metric label="Credits" value={venue?.creditsBalance ?? 0} />
              <Metric label="Approved" value={readySessions} />
              <Metric label="In production" value={processingSessions} />
              <Metric label="Venue refs" value={media.length} />
            </div>
          </motion.div>

          <motion.form
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            onSubmit={handleSaveProfile}
            className="glimpse-card p-6 md:p-8"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fdfbf7] border border-[#f5eedf] text-gold shadow-sm">
                <Building2 className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Inquiry details</h2>
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="venue-name" className="text-foreground font-medium">Venue name</Label>
                <Input
                  id="venue-name"
                  value={profile.name}
                  onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                  className="bg-background border-border h-11 px-4 shadow-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email" className="text-foreground font-medium">Inquiry email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={profile.contactEmail}
                  onChange={(e) => setProfile((prev) => ({ ...prev, contactEmail: e.target.value }))}
                  className="bg-background border-border h-11 px-4 shadow-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-url" className="text-foreground font-medium">Tour booking link</Label>
                <Input
                  id="booking-url"
                  value={profile.bookingUrl}
                  onChange={(e) => setProfile((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                  className="bg-background border-border h-11 px-4 shadow-sm"
                  placeholder="https://yourvenue.com/tours"
                />
              </div>
              <Button type="submit" disabled={saving} className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 font-medium">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save details
              </Button>
            </div>
          </motion.form>
        </section>

        <section className="glimpse-card p-6 md:p-8">
          <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gold">
                New couple
              </p>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Start a prospect gallery</h2>
              <p className="mt-3 text-base font-light leading-relaxed text-muted-foreground">
                Add the couple's email and reference photos. Glimpse creates a photoreal,
                venue-branded preview and emails their private link after generation.
              </p>
            </div>
            <Badge className={venueReady ? "inline-flex items-center gap-2 rounded-full border border-[#f0e6d2] bg-[#fdfbf7] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#8a7340] shadow-sm" : "inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-semibold tracking-wide text-amber-700 shadow-sm"}>
              {venueReady ? "Owner approval enabled" : "Venue setup needed"}
            </Badge>
          </div>

          <form onSubmit={handleStartGallery} className="grid gap-8 lg:grid-cols-[1fr_1fr_auto] lg:items-start bg-secondary/50 p-6 rounded-2xl border border-border/60">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="couple-name" className="text-foreground font-medium">Names</Label>
                <Input
                  id="couple-name"
                  value={coupleName}
                  onChange={(e) => setCoupleName(e.target.value)}
                  className="bg-background border-border h-11 px-4 shadow-sm"
                  placeholder="Avery & Jordan"
                  maxLength={80}
                  data-testid="owner-couple-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="couple-email" className="text-foreground font-medium">Email</Label>
                <Input
                  id="couple-email"
                  type="email"
                  value={coupleEmail}
                  onChange={(e) => setCoupleEmail(e.target.value)}
                  className="bg-background border-border h-11 px-4 shadow-sm"
                  placeholder="bride@example.com"
                  data-testid="owner-couple-email"
                />
              </div>
            </div>

            <div>
              <Label className="text-foreground font-medium block mb-2">Couple photos</Label>
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
                      className="relative aspect-square overflow-hidden rounded-xl border border-border bg-background shadow-sm text-muted-foreground transition-all hover:border-gold hover:text-gold group"
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
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white backdrop-blur-sm transition hover:bg-red-500"
                            aria-label="Remove couple photo"
                          >
                            <X className="h-4 w-4" />
                          </span>
                        </>
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs font-medium">
                          <ImageUp className="h-5 w-5 opacity-70 group-hover:opacity-100 transition-opacity" />
                          Photo {slot + 1}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => coupleFileInputRef.current?.click()}
                disabled={coupleFiles.length >= MAX_COUPLE_PHOTOS}
                className="mt-3 w-full border-dashed"
              >
                <Upload className="mr-2 h-4 w-4" />
                Select photos
              </Button>
            </div>

            <div className="lg:pt-8">
              <Button
                type="submit"
                variant="gold"
                disabled={
                  !venueReady ||
                  isStartingGallery ||
                  isUploadingCouple ||
                  createSession.isPending ||
                  coupleFiles.length < MIN_COUPLE_PHOTOS
                }
                className="w-full lg:w-auto h-14 px-8 text-base shadow-lg shadow-[#C2A36B]/20"
                data-testid="owner-start-gallery"
              >
                {isStartingGallery || isUploadingCouple || createSession.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-5 w-5" />
                )}
                Generate preview
              </Button>
            </div>
          </form>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              "Photoreal scale, lighting, and shadow cues",
              "Tasteful venue branding and inquiry CTA",
              "Preview first, then email or reuse in marketing",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-border/70 bg-white px-4 py-3 text-sm font-medium text-muted-foreground">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="glimpse-card p-6 md:p-8 flex flex-col">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">True-space readiness</h2>
                <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                  {missingCoverage.length === 0
                    ? "The venue has the visual coverage needed for accurate branded previews."
                    : "Recommended: add the missing room views so output can better preserve space, scale, and atmosphere."}
                </p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary border border-border text-muted-foreground shadow-sm">
                <ImageUp className="h-5 w-5" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-8">
              {COVERAGE_OPTIONS.map((option) => {
                const complete = presentCoverage.has(option.value);
                return (
                  <div
                    key={option.value}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                      complete
                        ? "border-[#f0e6d2] bg-[#fdfbf7] text-[#8a7340]"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete ? "bg-gold text-white" : "bg-muted"}`}>
                        {complete ? <Check className="h-3 w-3" /> : null}
                      </span>
                      {option.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-auto pt-4 border-t border-border">
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
                className="h-12 w-full bg-foreground text-background hover:bg-foreground/90 font-medium"
              >
                {isUploadingVenue || addMedia.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {isUploadingVenue ? `Uploading ${venueUploadProgress}%` : "Add venue photo"}
              </Button>
            </div>
          </div>

          <div className="glimpse-card p-6 md:p-8">
            <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">Venue reference library</h2>
                <p className="mt-1 text-sm font-light text-muted-foreground">Real spaces power accurate scale, lighting, and shadows.</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
                {media.length} photos
              </div>
            </div>

            {media.length === 0 ? (
              <div className="flex min-h-64 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-secondary/50">
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  <p className="text-sm font-medium">No venue photos yet.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {media.map((item) => (
                  <div key={item.id} className="group relative aspect-square overflow-hidden rounded-xl bg-secondary border border-border shadow-sm">
                    <img
                      src={venueReferenceUrl(item.objectKey, selectedSlug)}
                      alt="Venue reference"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(item.id)}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-red-600 shadow-sm backdrop-blur-sm opacity-0 transition group-hover:opacity-100 hover:bg-red-600 hover:text-white"
                      aria-label="Delete venue photo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <span className="absolute bottom-3 left-3 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 capitalize drop-shadow-md">
                      {item.coverage.replace("_", " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="glimpse-card p-6 md:p-8">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Prospect galleries</h2>
              <p className="mt-2 text-base font-light text-muted-foreground">
                Review output, approve delivery, and reuse compact variants for follow-up campaigns.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-background">
            {sessions.length === 0 ? (
              <div className="flex min-h-[200px] items-center justify-center text-center text-sm font-medium text-muted-foreground bg-secondary/50">
                No prospect galleries yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="grid gap-4 p-5 md:grid-cols-[72px_1fr_auto] md:items-center hover:bg-secondary/50 transition-colors"
                  >
                    <div className="h-18 w-18 overflow-hidden rounded-xl border border-border bg-secondary shadow-sm">
                      {session.thumbnailObjectKey ? (
                        <img
                          src={ownerAssetUrl(session.thumbnailObjectKey)}
                          alt="Gallery thumbnail"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-3 mb-1">
                        <p className="font-bold text-base text-foreground">{session.coupleName || "Prospect gallery"}</p>
                        <StatusBadge status={session.status} />
                      </div>
                      <p className="text-sm font-light text-muted-foreground flex items-center gap-2">
                        <span>{session.coupleEmail || "No email provided"}</span>
                        <span className="text-border">•</span>
                        <span>{new Date(session.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row md:justify-end mt-2 md:mt-0">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!session.shareToken}
                        onClick={() => handleViewGallery(session.shareToken)}
                        className="bg-background"
                        data-testid={`view-gallery-${session.id}`}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Preview
                      </Button>
                      <Button
                        type="button"
                        disabled={
                          session.status !== "ready" ||
                          !session.coupleEmail ||
                          sendingSessionId === session.id
                        }
                        onClick={() => handleSendGallery(session.id, session.coupleEmail)}
                        className="bg-foreground text-background hover:bg-foreground/90"
                      >
                        {sendingSessionId === session.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Mail className="mr-2 h-4 w-4" />
                        )}
                        Email gallery
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={deleteSession.isPending && deleteSession.variables?.id === session.id}
                        onClick={() => handleDeleteSession(session.id, session.coupleName)}
                        className="bg-background text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        data-testid={`delete-gallery-${session.id}`}
                      >
                        {deleteSession.isPending && deleteSession.variables?.id === session.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete
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
    <div className="rounded-2xl border border-border bg-background p-6 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "ready"
      ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700"
      : status === "failed"
        ? "inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold tracking-wide text-red-700"
        : "inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-wide text-amber-700";
  
  return (
    <span className={classes}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "ready" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : "bg-amber-500"}`}></span>
      {status}
    </span>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAddVenueMedia,
  useCreateOrgBillingCheckout,
  useCreateOrgBillingPortal,
  useCreateSession,
  useDeleteSession,
  useDeleteVenueMedia,
  useGetOrganization,
  useGetVenueDashboard,
  useListVenueMedia,
  useUpdateVenue,
  getGetOrganizationQueryKey,
  getGetVenueDashboardQueryKey,
  getListVenueMediaQueryKey,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { ClerkSetupNotice, OrgGate } from "@/components/auth/OrgGate";
import { clerkConfigured } from "@/lib/clerk";

type BillingProductId = "starter" | "growth" | "credit_pack";

const BILLING_PRODUCTS: Array<{
  id: BillingProductId;
  kicker: string;
  title: string;
  description: string;
  credits: string;
  cta: string;
}> = [
  {
    id: "starter",
    kicker: "Plan 01",
    title: "Starter",
    description:
      "For a single active venue building post-tour follow-up into the sales flow.",
    credits: "25 credits / month",
    cta: "Subscribe to Starter",
  },
  {
    id: "growth",
    kicker: "Plan 02",
    title: "Growth",
    description:
      "For organizations running several venues or a full tour calendar.",
    credits: "100 credits / month",
    cta: "Subscribe to Growth",
  },
  {
    id: "credit_pack",
    kicker: "Top-up",
    title: "Credit pack",
    description:
      "One-off boost when a busy weekend outruns the monthly allowance.",
    credits: "+10 credits, one time",
    cta: "Buy credit pack",
  },
];
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
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
  return withQueryParam(
    normalizeStorageObjectPath(objectKey),
    "venueSlug",
    venueSlug,
  );
}

function ownerAssetUrl(objectKey: string): string {
  return normalizeStorageObjectPath(objectKey);
}

export default function VenueOwnerPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <OrgGate>
      <DashboardInner />
    </OrgGate>
  );
}

function DashboardInner() {
  const [workspaceTab, setWorkspaceTab] = useState("galleries");

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { signOut } = useClerk();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coupleFileInputRef = useRef<HTMLInputElement>(null);
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

  // The organization is the tenant: it carries billing (plan + shared
  // credits) and the list of venues the member can manage.
  const orgQuery = useGetOrganization({
    query: { queryKey: getGetOrganizationQueryKey() },
  });
  const organization = orgQuery.data?.organization;
  const orgVenues = orgQuery.data?.venues ?? [];

  useEffect(() => {
    if (!orgQuery.isSuccess) return;
    const firstVenue = orgQuery.data.venues[0];
    if (!firstVenue) {
      setLocation("/create-venue");
      return;
    }
    setSelectedSlug((current) =>
      current && orgQuery.data.venues.some((v) => v.slug === current)
        ? current
        : firstVenue.slug,
    );
  }, [orgQuery.isSuccess, orgQuery.data, setLocation]);

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
  const {
    uploadFile: uploadVenueFile,
    isUploading: isUploadingVenue,
    progress: venueUploadProgress,
  } = useUpload({
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
  const { uploadFile: uploadCoupleFile, isUploading: isUploadingCouple } =
    useUpload({
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
  const missingCoverage = COVERAGE_OPTIONS.filter(
    (option) => !presentCoverage.has(option.value),
  );
  const nextCoverage: Coverage = missingCoverage[0]?.value ?? "detail";
  const readySessions = sessions.filter(
    (session) => session.status === "ready",
  ).length;
  const processingSessions = sessions.filter(
    (session) =>
      session.status === "processing" || session.status === "pending",
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

  const handleSendGallery = async (
    sessionId: number,
    coupleEmail?: string | null,
  ) => {
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

  const handleDeleteSession = (
    sessionId: number,
    coupleName?: string | null,
  ) => {
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
      .filter((file) =>
        ["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
      .slice(0, availableSlots);
    if (accepted.length === 0) {
      toast({
        title: "Use JPG, PNG, or WebP photos",
        variant: "destructive",
      });
      return;
    }

    setCoupleFiles((prev) =>
      [...prev, ...accepted].slice(0, MAX_COUPLE_PHOTOS),
    );
    setCouplePreviews((prev) =>
      [...prev, ...accepted.map((file) => URL.createObjectURL(file))].slice(
        0,
        MAX_COUPLE_PHOTOS,
      ),
    );
  };

  const removeCoupleFile = (index: number) => {
    setCoupleFiles((prev) =>
      prev.filter((_, fileIndex) => fileIndex !== index),
    );
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
        description:
          "Add the required venue views before starting couple galleries.",
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
          lastCoupleUploadError.current ??
            "At least one couple photo must upload successfully.",
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
    await signOut();
    setLocation("/login");
  };

  const startCheckout = useCreateOrgBillingCheckout();
  const openPortal = useCreateOrgBillingPortal();
  const [checkoutProduct, setCheckoutProduct] =
    useState<BillingProductId | null>(null);

  const handleCheckout = (product: BillingProductId) => {
    setCheckoutProduct(product);
    startCheckout.mutate(
      { data: { product } },
      {
        onSuccess: (data) => {
          window.location.assign(data.url);
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          setCheckoutProduct(null);
          toast({
            title: "Could not start checkout",
            description: err.data?.error ?? "Try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleOpenPortal = () => {
    openPortal.mutate(undefined, {
      onSuccess: (data) => {
        window.location.assign(data.url);
      },
      onError: (err: ErrorType<ErrorEnvelope>) => {
        toast({
          title: "Could not open billing portal",
          description: err.data?.error ?? "Try again.",
          variant: "destructive",
        });
      },
    });
  };

  // Returning from Stripe Checkout: refresh org billing state and confirm.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    window.history.replaceState(null, "", window.location.pathname);
    void queryClient.invalidateQueries({
      queryKey: getGetOrganizationQueryKey(),
    });
    if (billing === "success") {
      toast({
        title: "Billing updated",
        description: "Credits apply as soon as Stripe confirms the payment.",
      });
    }
  }, [queryClient, toast]);

  if (orgQuery.isError || dashboard.isError)
    return (
      <div className="state-panel">
        <h1>We couldn’t open your workspace</h1>
        <p>Check your connection, then try loading your venue again.</p>
        <Button
          onClick={() => {
            void orgQuery.refetch();
            void dashboard.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (orgQuery.isLoading || dashboard.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="workspace">
      <aside className="workspace-nav">
        <GlimpseLogo />
        <nav aria-label="Workspace">
          {[
            ["galleries", "Couple galleries"],
            ["new", "Create a gallery"],
            ["photos", "Venue photos"],
            ["settings", "Venue details"],
            ["billing", "Plan & credits"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={workspaceTab === id ? "page" : undefined}
              onClick={() => setWorkspaceTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="workspace-mobile-nav">
          <label htmlFor="workspace-view">Workspace view</label>
          <select
            id="workspace-view"
            value={workspaceTab}
            onChange={(e) => setWorkspaceTab(e.target.value)}
          >
            {[
              ["galleries", "Couple galleries"],
              ["new", "Create a gallery"],
              ["photos", "Venue photos"],
              ["settings", "Venue details"],
              ["billing", "Plan & credits"],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">Workspace</span>
              <div className="hidden h-4 w-px bg-border sm:block"></div>
              <p className="eyebrow hidden normal-case tracking-normal text-muted-foreground sm:block">
                {organization?.name ?? ""}
                {user?.primaryEmailAddress
                  ? ` · ${user.primaryEmailAddress.emailAddress}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {orgVenues.length > 1 ? (
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium outline-none focus:border-brand focus:ring-1 focus:ring-ring"
                  aria-label="Switch venue"
                >
                  {orgVenues.map((ownedVenue) => (
                    <option key={ownedVenue.id} value={ownedVenue.slug}>
                      {ownedVenue.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/create-venue")}
                className="text-muted-foreground hover:text-foreground"
              >
                Add venue
              </Button>
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

        <main id="main-content" className="workspace-main">
          <section className="workspace-overview">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="overview-content"
            >
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="eyebrow mb-4 text-brand">Venue dashboard</p>
                  <h1 className="font-display text-3xl md:text-4xl font-medium tracking-tight text-foreground">
                    {venue?.name ?? "Your venue"}
                  </h1>
                  <p className="mt-3 max-w-xl text-base font-light leading-relaxed text-muted-foreground">
                    Create, review, and share a more personal follow-up.
                  </p>
                </div>
                <p
                  className={
                    venueReady
                      ? "eyebrow shrink-0 inline-flex items-center gap-2 text-emerald-700"
                      : "eyebrow shrink-0 inline-flex items-center gap-2 text-brand"
                  }
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {venueReady ? "Ready for tours" : "Needs photos"}
                </p>
              </div>

              <div className="workspace-metrics">
                <Metric
                  label="Credits available"
                  value={organization?.creditsBalance ?? 0}
                  hero
                />
                <Metric label="Approved" value={readySessions} />
                <Metric label="In production" value={processingSessions} />
                <Metric label="Venue photos" value={media.length} />
              </div>
            </motion.div>
          </section>

          {workspaceTab === "settings" && (
            <section className="workspace-settings">
              {" "}
              <motion.form
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.05 }}
                onSubmit={handleSaveProfile}
                className="bg-card border border-card-border rounded-lg p-6 md:p-8"
              >
                <div className="mb-6">
                  <p className="eyebrow mb-3 text-brand">Settings</p>
                  <h2 className="font-display text-2xl font-medium text-foreground">
                    Inquiry details
                  </h2>
                </div>
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="venue-name"
                      className="eyebrow text-muted-foreground"
                    >
                      Venue name
                    </Label>
                    <Input
                      id="venue-name"
                      value={profile.name}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className="bg-background border-border h-11 px-4"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="contact-email"
                      className="eyebrow text-muted-foreground"
                    >
                      Inquiry email
                    </Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={profile.contactEmail}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          contactEmail: e.target.value,
                        }))
                      }
                      className="bg-background border-border h-11 px-4"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="booking-url"
                      className="eyebrow text-muted-foreground"
                    >
                      Tour booking link
                    </Label>
                    <Input
                      id="booking-url"
                      value={profile.bookingUrl}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          bookingUrl: e.target.value,
                        }))
                      }
                      className="bg-background border-border h-11 px-4"
                      placeholder="https://yourvenue.com/tours"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={saving}
                    className="w-full h-11 font-medium"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save details
                  </Button>
                </div>
              </motion.form>
            </section>
          )}
          {workspaceTab === "new" && (
            <section className="border-t border-border pt-6">
              <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="max-w-2xl">
                  <p className="eyebrow mb-4 text-brand">New couple</p>
                  <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight text-foreground">
                    Create a couple’s gallery
                  </h2>
                  <p className="mt-3 text-base font-light leading-relaxed text-muted-foreground">
                    Add the couple's email and reference photos. Glimpse creates
                    a photoreal, venue-branded preview and emails their private
                    link after generation.
                  </p>
                </div>
                <p
                  className={
                    venueReady
                      ? "eyebrow shrink-0 inline-flex items-center gap-2 text-emerald-700"
                      : "eyebrow shrink-0 inline-flex items-center gap-2 text-brand"
                  }
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {venueReady ? "Owner approval enabled" : "Venue setup needed"}
                </p>
              </div>

              <form
                onSubmit={handleStartGallery}
                className="grid gap-8 lg:grid-cols-[1fr_1fr_auto] lg:items-start bg-card p-6 rounded-lg border border-card-border"
              >
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="couple-name"
                      className="eyebrow text-muted-foreground"
                    >
                      Names
                    </Label>
                    <Input
                      id="couple-name"
                      value={coupleName}
                      onChange={(e) => setCoupleName(e.target.value)}
                      className="bg-background border-border h-11 px-4"
                      placeholder="Avery & Jordan"
                      maxLength={80}
                      data-testid="owner-couple-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="couple-email"
                      className="eyebrow text-muted-foreground"
                    >
                      Email
                    </Label>
                    <Input
                      id="couple-email"
                      type="email"
                      value={coupleEmail}
                      onChange={(e) => setCoupleEmail(e.target.value)}
                      className="bg-background border-border h-11 px-4"
                      placeholder="bride@example.com"
                      data-testid="owner-couple-email"
                    />
                  </div>
                </div>

                <div>
                  <Label className="eyebrow text-muted-foreground block mb-2">
                    Couple photos
                  </Label>
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
                          className="relative aspect-square overflow-hidden border border-border bg-background text-muted-foreground transition-colors hover:border-brand hover:text-brand group"
                          aria-label={
                            preview
                              ? `Couple photo ${slot + 1}`
                              : "Add couple photo"
                          }
                        >
                          {preview ? (
                            <>
                              <img
                                src={preview}
                                alt={`Couple reference ${slot + 1}`}
                                className="h-full w-full object-cover"
                              />
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
                            <div className="eyebrow flex h-full w-full flex-col items-center justify-center gap-2">
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
                    variant="brand"
                    disabled={
                      !venueReady ||
                      isStartingGallery ||
                      isUploadingCouple ||
                      createSession.isPending ||
                      coupleFiles.length < MIN_COUPLE_PHOTOS
                    }
                    className="w-full lg:w-auto h-14 px-8 text-base"
                    data-testid="owner-start-gallery"
                  >
                    {isStartingGallery ||
                    isUploadingCouple ||
                    createSession.isPending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-5 w-5" />
                    )}
                    Generate preview
                  </Button>
                </div>
              </form>

              <div className="mt-8 grid md:grid-cols-3 md:gap-10">
                {[
                  "Photoreal scale, lighting, and shadow cues",
                  "Tasteful venue branding and inquiry CTA",
                  "Preview first, then email or reuse in marketing",
                ].map((item, index) => (
                  <div
                    key={item}
                    className="flex items-baseline gap-4 border-t border-border py-4"
                  >
                    <span className="eyebrow text-brand">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {workspaceTab === "photos" && (
            <section className="grid gap-10 border-t border-border pt-6 lg:grid-cols-[420px_1fr]">
              <div className="flex flex-col">
                <div className="mb-6">
                  <p className="eyebrow mb-4 text-brand">Coverage</p>
                  <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground">
                    Prepare your venue
                  </h2>
                  <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                    {missingCoverage.length === 0
                      ? "The venue has the visual coverage needed for accurate branded previews."
                      : "Recommended: add the missing room views so output can better preserve space, scale, and atmosphere."}
                  </p>
                </div>

                <div className="mb-8">
                  {COVERAGE_OPTIONS.map((option) => {
                    const complete = presentCoverage.has(option.value);
                    return (
                      <div
                        key={option.value}
                        className="flex items-center justify-between border-t border-border py-3 transition-colors hover:bg-soft last:border-b"
                      >
                        <span
                          className={`text-sm font-medium ${complete ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {option.label}
                        </span>
                        {complete ? (
                          <Check className="h-4 w-4 shrink-0 text-brand" />
                        ) : (
                          <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-auto pt-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleUpload}
                  />
                  <Button
                    type="button"
                    variant="brand"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingVenue || addMedia.isPending}
                    className="h-12 w-full font-medium"
                  >
                    {isUploadingVenue || addMedia.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {isUploadingVenue
                      ? `Uploading ${venueUploadProgress}%`
                      : "Add venue photo"}
                  </Button>
                </div>
              </div>

              <div>
                <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <p className="eyebrow mb-4 text-brand">Library</p>
                    <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground">
                      Your venue photos
                    </h2>
                    <p className="mt-1 text-sm font-light text-muted-foreground">
                      Real spaces power accurate scale, lighting, and shadows.
                    </p>
                  </div>
                  <p className="eyebrow shrink-0 text-muted-foreground">
                    {media.length} photos
                  </p>
                </div>

                {media.length === 0 ? (
                  <div className="flex min-h-64 items-center justify-center border border-dashed border-border">
                    <div className="text-center text-muted-foreground">
                      <ImageIcon className="mx-auto mb-3 h-8 w-8 opacity-50" />
                      <p className="eyebrow">
                        Add photos of your venue to help couples picture their
                        day.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {media.map((item) => (
                      <div
                        key={item.id}
                        className="group relative aspect-square overflow-hidden bg-secondary border border-border"
                      >
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
                          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/75 text-white backdrop-blur-sm opacity-0 transition group-hover:opacity-100 hover:bg-red-500 hover:text-white"
                          aria-label="Delete venue photo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <span className="eyebrow absolute bottom-3 left-3 text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                          {item.coverage.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {workspaceTab === "galleries" && (
            <section className="border-t border-border pt-6">
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="eyebrow mb-4 text-brand">Deliveries</p>
                  <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground">
                    Couple galleries
                  </h2>
                  <p className="mt-2 text-base font-light text-muted-foreground">
                    Review each gallery and send the couple their private link.
                  </p>
                </div>
              </div>

              <div>
                {sessions.length === 0 ? (
                  <div className="flex min-h-[200px] items-center justify-center border border-dashed border-border text-center">
                    <p className="eyebrow text-muted-foreground">
                      Your first gallery starts here. Use Create a gallery to
                      invite a couple.
                    </p>
                  </div>
                ) : (
                  <div>
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="grid gap-4 border-t border-border py-4 last:border-b md:grid-cols-[96px_72px_1fr_auto] md:items-center md:px-2 hover:bg-soft transition-colors"
                      >
                        <p className="font-mono text-xs text-muted-foreground">
                          {new Date(session.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </p>
                        <div className="relative h-18 w-18 overflow-hidden border border-border bg-secondary">
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
                            <p className="font-display text-lg font-medium text-foreground">
                              {session.coupleName || "Prospect gallery"}
                            </p>
                            <StatusBadge status={session.status} />
                          </div>
                          <p className="text-sm font-light text-muted-foreground">
                            {session.coupleEmail || "No email provided"}
                          </p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row md:justify-end mt-2 md:mt-0">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!session.shareToken}
                            onClick={() =>
                              handleViewGallery(session.shareToken)
                            }
                            data-testid={`view-gallery-${session.id}`}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Preview
                          </Button>
                          <Button
                            type="button"
                            variant="brand"
                            disabled={
                              session.status !== "ready" ||
                              !session.coupleEmail ||
                              sendingSessionId === session.id
                            }
                            onClick={() =>
                              handleSendGallery(session.id, session.coupleEmail)
                            }
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
                            variant="ghost"
                            disabled={
                              deleteSession.isPending &&
                              deleteSession.variables?.id === session.id
                            }
                            onClick={() =>
                              handleDeleteSession(
                                session.id,
                                session.coupleName,
                              )
                            }
                            className="text-red-700 hover:text-red-800"
                            data-testid={`delete-gallery-${session.id}`}
                          >
                            {deleteSession.isPending &&
                            deleteSession.variables?.id === session.id ? (
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
          )}

          {/* Billing lives on the organization: one plan and one credit pool
            shared by every venue. Checkout + payment methods are Clerk
            Billing; credits are granted server-side by the Clerk webhook. */}
          {workspaceTab === "billing" && (
            <section className="border-t border-border pt-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="eyebrow mb-4 text-brand">
                    Organization billing
                  </p>
                  <h2 className="font-display text-2xl md:text-3xl font-medium text-foreground">
                    {organization?.name ?? "Your organization"}
                  </h2>
                  <p className="mt-3 max-w-xl text-base font-light leading-relaxed text-muted-foreground">
                    One subscription covers every venue in your organization.
                    Each couple gallery uses one credit from the shared balance.
                  </p>
                </div>
                <div className="flex items-end gap-10">
                  <div>
                    <p className="eyebrow text-muted-foreground">Plan</p>
                    <p className="mt-2 font-mono text-2xl uppercase tracking-tight text-foreground">
                      {organization?.plan ?? "trial"}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow text-muted-foreground">Credits</p>
                    <p className="mt-2 font-display text-4xl font-medium tracking-tight text-brand">
                      {organization?.creditsBalance ?? 0}
                    </p>
                  </div>
                  {organization?.billingPeriodEnd ? (
                    <div>
                      <p className="eyebrow text-muted-foreground">Renews</p>
                      <p className="mt-2 font-mono text-sm text-foreground">
                        {new Date(
                          organization.billingPeriodEnd,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-10 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
                {BILLING_PRODUCTS.map((product) => (
                  <div
                    key={product.id}
                    className="flex flex-col bg-background p-6 md:p-8"
                  >
                    <p className="eyebrow text-brand">{product.kicker}</p>
                    <h3 className="mt-3 font-display text-2xl font-medium text-foreground">
                      {product.title}
                    </h3>
                    <p className="mt-2 flex-1 text-sm font-light leading-relaxed text-muted-foreground">
                      {product.description}
                    </p>
                    <p className="mt-6 font-mono text-sm text-muted-foreground">
                      {product.credits}
                    </p>
                    <Button
                      variant={
                        organization?.plan === product.id ? "outline" : "brand"
                      }
                      disabled={
                        startCheckout.isPending ||
                        organization?.plan === product.id
                      }
                      onClick={() => handleCheckout(product.id)}
                      className="mt-4 w-full rounded-md"
                      data-testid={`billing-${product.id}`}
                    >
                      {startCheckout.isPending &&
                      checkoutProduct === product.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {organization?.plan === product.id
                        ? "Current plan"
                        : product.cta}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="eyebrow normal-case tracking-[0.08em] text-muted-foreground">
                  Stripe billing, owned by the organization · renewals refresh
                  the shared credit pool · 1 credit = 1 couple's complete
                  gallery
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={openPortal.isPending}
                  onClick={handleOpenPortal}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="billing-portal"
                >
                  {openPortal.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Manage billing in Stripe
                </Button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hero = false,
}: {
  label: string;
  value: number | string;
  hero?: boolean;
}) {
  return (
    <div className="border-t border-border pt-4">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p
        className={
          hero
            ? "mt-2 font-display text-4xl md:text-5xl font-medium tracking-tight text-brand"
            : "mt-2 font-mono text-3xl tracking-tight text-foreground"
        }
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "ready"
      ? "text-emerald-700"
      : status === "failed"
        ? "text-red-700"
        : "text-brand";

  return (
    <span className={`eyebrow inline-flex items-center gap-1.5 ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current"></span>
      {status}
    </span>
  );
}

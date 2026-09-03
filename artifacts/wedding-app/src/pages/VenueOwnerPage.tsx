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
  type VenueMediaCoverage,
} from "@workspace/api-client-react";
import { useClerk } from "@clerk/clerk-react";
import { useUpload } from "@workspace/object-storage-web";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { ClerkSetupNotice, OrgGate } from "@/components/auth/OrgGate";
import { clerkConfigured } from "@/lib/clerk";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DashboardHeader } from "./dashboard/DashboardHeader";
import { CoupleLinkCard } from "./dashboard/CoupleLinkCard";
import { GalleriesSection, type NewGalleryDraft } from "./dashboard/GalleriesSection";
import { VenuePhotosSection } from "./dashboard/VenuePhotosSection";
import { AccountSection, type VenueProfileDraft } from "./dashboard/AccountSection";
import {
  MAX_COUPLE_PHOTOS,
  MIN_COUPLE_PHOTOS,
  MIN_VENUE_PHOTOS,
  coupleLinkFor,
  type BillingProductId,
} from "./dashboard/types";

export default function VenueOwnerPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <OrgGate>
      <DashboardInner />
    </OrgGate>
  );
}

const EMPTY_DRAFT: NewGalleryDraft = { coupleName: "", coupleEmail: "", files: [], previews: [] };

function DashboardInner() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const [selectedSlug, setSelectedSlug] = useState<string>("");

  // The organization is the tenant: billing (plan + shared credits) and the
  // venues the member can manage.
  const orgQuery = useGetOrganization({ query: { queryKey: getGetOrganizationQueryKey(), retry: 1 } });
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
      current && orgQuery.data.venues.some((v) => v.slug === current) ? current : firstVenue.slug,
    );
  }, [orgQuery.isSuccess, orgQuery.data, setLocation]);

  const dashboard = useGetVenueDashboard(selectedSlug, {
    query: { enabled: Boolean(selectedSlug), queryKey: getGetVenueDashboardQueryKey(selectedSlug) },
  });
  const mediaQuery = useListVenueMedia(selectedSlug, {
    query: { enabled: Boolean(selectedSlug), queryKey: getListVenueMediaQueryKey(selectedSlug) },
    request: {},
  });
  const addMedia = useAddVenueMedia({ request: {} });
  const deleteMedia = useDeleteVenueMedia({ request: {} });
  const updateVenue = useUpdateVenue({ request: {} });
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const venue = dashboard.data?.venue;
  const sessions = dashboard.data?.sessions ?? [];
  const media = mediaQuery.data?.media ?? [];
  const venueReady = media.length >= MIN_VENUE_PHOTOS;
  const creditsBalance = organization?.creditsBalance ?? 0;
  const readyCount = sessions.filter((s) => s.status === "ready").length;
  const developingCount = sessions.filter((s) => s.status === "processing" || s.status === "pending").length;

  // ——— Venue photos ———
  const { uploadFile: uploadVenueFile, isUploading: isUploadingVenue, progress: venueUploadProgress } = useUpload({
    purpose: "venue",
    venueSlug: selectedSlug,
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const handleVenueUpload = async (file: File, coverage: VenueMediaCoverage) => {
    if (!selectedSlug) return;
    const result = await uploadVenueFile(file);
    if (!result) return;
    addMedia.mutate(
      { slug: selectedSlug, data: { objectKey: result.objectPath, coverage, displayOrder: media.length } },
      {
        onSuccess: () => {
          toast({ title: "Photo added" });
          void mediaQuery.refetch();
        },
        onError: (err: ErrorType<ErrorEnvelope>) =>
          toast({ title: "Photo wasn't saved", description: err.data?.error ?? "Try another image.", variant: "destructive" }),
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
        onError: (err: ErrorType<ErrorEnvelope>) =>
          toast({ title: "Couldn't remove photo", description: err.data?.error ?? "Try again.", variant: "destructive" }),
      },
    );
  };

  // ——— Venue details ———
  const [profile, setProfile] = useState<VenueProfileDraft>({ name: "", contactEmail: "", bookingUrl: "" });
  const [savedProfile, setSavedProfile] = useState<VenueProfileDraft>(profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!venue) return;
    const next = {
      name: venue.name ?? "",
      contactEmail: venue.contactEmail ?? venue.ownerEmail ?? "",
      bookingUrl: venue.bookingUrl ?? "",
    };
    setProfile(next);
    setSavedProfile(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id]);
  const profileDirty =
    profile.name !== savedProfile.name ||
    profile.contactEmail !== savedProfile.contactEmail ||
    profile.bookingUrl !== savedProfile.bookingUrl;

  const handleSaveProfile = () => {
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
          setSavedProfile(profile);
          toast({ title: "Venue details saved" });
          void queryClient.invalidateQueries({ queryKey: getGetVenueDashboardQueryKey(selectedSlug) });
          void queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
        },
        onError: (err: ErrorType<ErrorEnvelope>) =>
          toast({ title: "Save failed", description: err.data?.error ?? "Try again.", variant: "destructive" }),
        onSettled: () => setSaving(false),
      },
    );
  };

  // ——— Galleries ———
  const [sendingSessionId, setSendingSessionId] = useState<number | null>(null);
  const [sentSessionId, setSentSessionId] = useState<number | null>(null);
  const handleSendGallery = async (sessionId: number, coupleEmail?: string | null) => {
    if (!coupleEmail) {
      toast({ title: "No email on this gallery", description: "Add the couple's email to send it.", variant: "destructive" });
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
      toast({ title: "Gallery emailed", description: `Sent to ${coupleEmail}.` });
      setSentSessionId(sessionId);
      window.setTimeout(() => setSentSessionId((id) => (id === sessionId ? null : id)), 4000);
    } catch (err) {
      toast({ title: "Email failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSendingSessionId(null);
    }
  };

  const handleDeleteSession = (sessionId: number) => {
    deleteSession.mutate(
      { id: sessionId },
      {
        onSuccess: () => {
          toast({ title: "Gallery deleted" });
          void queryClient.invalidateQueries({ queryKey: getGetVenueDashboardQueryKey(selectedSlug) });
        },
        onError: (err: ErrorType<ErrorEnvelope>) =>
          toast({ title: "Delete failed", description: err.data?.error ?? "Try again.", variant: "destructive" }),
      },
    );
  };

  const handleOpenGallery = (shareToken?: string | null) => {
    if (!shareToken) {
      toast({ title: "No link yet", description: "This gallery doesn't have a share link yet.", variant: "destructive" });
      return;
    }
    window.open(`/v/${shareToken}`, "_blank", "noopener,noreferrer");
  };

  // ——— New gallery intake ———
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [draft, setDraft] = useState<NewGalleryDraft>(EMPTY_DRAFT);
  const [isStarting, setIsStarting] = useState(false);
  const previewsRef = useRef<string[]>([]);
  useEffect(() => {
    previewsRef.current = draft.previews;
  }, [draft.previews]);
  useEffect(() => () => previewsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const lastCoupleUploadError = useRef<string | null>(null);
  const { uploadFile: uploadCoupleFile } = useUpload({
    purpose: "couple",
    venueSlug: selectedSlug,
    onError: (err) => {
      lastCoupleUploadError.current = err.message;
    },
  });

  const addDraftFiles = (files: File[]) => {
    if (files.length === 0) return;
    const slots = MAX_COUPLE_PHOTOS - draft.files.length;
    if (slots <= 0) {
      toast({ title: "Three photos is the limit" });
      return;
    }
    const accepted = files.filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type)).slice(0, slots);
    if (accepted.length === 0) {
      toast({ title: "Use JPG, PNG, or WebP photos", variant: "destructive" });
      return;
    }
    setDraft((d) => ({
      ...d,
      files: [...d.files, ...accepted].slice(0, MAX_COUPLE_PHOTOS),
      previews: [...d.previews, ...accepted.map((f) => URL.createObjectURL(f))].slice(0, MAX_COUPLE_PHOTOS),
    }));
  };
  const removeDraftFile = (index: number) => {
    setDraft((d) => {
      const removed = d.previews[index];
      if (removed) URL.revokeObjectURL(removed);
      return { ...d, files: d.files.filter((_, i) => i !== index), previews: d.previews.filter((_, i) => i !== index) };
    });
  };
  const resetDraft = () => {
    draft.previews.forEach((url) => URL.revokeObjectURL(url));
    setDraft(EMPTY_DRAFT);
  };

  const handleStartGallery = async () => {
    if (!selectedSlug || !venueReady) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.coupleEmail.trim())) {
      toast({ title: "Check the couple's email", description: "That's where the finished gallery goes.", variant: "destructive" });
      return;
    }
    if (draft.files.length < MIN_COUPLE_PHOTOS) {
      toast({ title: "Add at least one photo", variant: "destructive" });
      return;
    }
    setIsStarting(true);
    try {
      lastCoupleUploadError.current = null;
      const couplePhotoKeys: string[] = [];
      for (const file of draft.files) {
        const uploaded = await uploadCoupleFile(file);
        if (uploaded) couplePhotoKeys.push(uploaded.objectPath);
      }
      if (couplePhotoKeys.length < MIN_COUPLE_PHOTOS) {
        throw new Error(lastCoupleUploadError.current ?? "At least one photo must upload successfully.");
      }
      createSession.mutate(
        {
          slug: selectedSlug,
          data: {
            coupleName: draft.coupleName.trim() || undefined,
            coupleEmail: draft.coupleEmail.trim().toLowerCase(),
            couplePhotoKeys,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Gallery started", description: "It appears in the list below and we email the couple when it's ready." });
            resetDraft();
            setIntakeOpen(false);
            void dashboard.refetch();
            void queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
          },
          onError: (err: ErrorType<ErrorEnvelope>) =>
            toast({ title: "Couldn't start the gallery", description: err.data?.error ?? "Try again.", variant: "destructive" }),
          onSettled: () => setIsStarting(false),
        },
      );
    } catch (err) {
      setIsStarting(false);
      toast({ title: "Couldn't start the gallery", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  };

  // ——— Billing ———
  const startCheckout = useCreateOrgBillingCheckout();
  const openPortal = useCreateOrgBillingPortal();
  const [checkoutProduct, setCheckoutProduct] = useState<BillingProductId | null>(null);
  const handleCheckout = (product: BillingProductId) => {
    setCheckoutProduct(product);
    startCheckout.mutate(
      { data: { product } },
      {
        onSuccess: (data) => window.location.assign(data.url),
        onError: (err: ErrorType<ErrorEnvelope>) => {
          setCheckoutProduct(null);
          toast({ title: "Couldn't start checkout", description: err.data?.error ?? "Try again.", variant: "destructive" });
        },
      },
    );
  };
  const handleOpenPortal = () => {
    openPortal.mutate(undefined, {
      onSuccess: (data) => window.location.assign(data.url),
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Couldn't open billing", description: err.data?.error ?? "Try again.", variant: "destructive" }),
    });
  };
  const billingRef = useRef<HTMLDivElement>(null);
  const goToBilling = () => billingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Returning from Stripe Checkout: refresh org billing state and confirm.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    window.history.replaceState(null, "", window.location.pathname);
    void queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey() });
    if (billing === "success") {
      toast({ title: "Billing updated", description: "Credits apply as soon as Stripe confirms the payment." });
    }
  }, [queryClient, toast]);

  const coupleLink = useMemo(() => (selectedSlug ? coupleLinkFor(selectedSlug) : ""), [selectedSlug]);

  if (orgQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="mono-label text-rose">Dashboard</p>
        <h1 className="font-display text-2xl font-medium">We couldn't load your organization</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Check your connection, then try again.</p>
        <Button variant="rose" onClick={() => orgQuery.refetch()} className="h-11 px-6">
          Try again
        </Button>
      </div>
    );
  }

  if (orgQuery.isLoading || !selectedSlug || dashboard.isLoading || mediaQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader
        venues={orgVenues}
        selectedSlug={selectedSlug}
        onSelectVenue={setSelectedSlug}
        onAddVenue={() => setLocation("/create-venue")}
        onSignOut={async () => {
          await signOut();
          setLocation("/login");
        }}
      />

      <main className="mx-auto max-w-6xl space-y-14 px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
        {/* Overview: who you are, where you stand, and the link that starts everything. */}
        <section aria-labelledby="venue-title" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-stretch">
          <div className="flex flex-col justify-between">
            <p className="mono-label mb-3 text-rose">Venue</p>
            <h1 id="venue-title" className="font-display text-4xl font-medium tracking-tight md:text-5xl">
              {venue?.name ?? "Your venue"}
            </h1>
            <p className={cn("mono-label mt-4 inline-flex items-center gap-2", venueReady ? "text-emerald-300" : "text-rose")}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {venueReady ? "Open for couples" : "Add a venue photo to open"}
            </p>

            <dl className="mt-8 grid max-w-xl grid-cols-3 gap-4 border-t border-border pt-4 lg:mt-10">
              <Metric label="Credits" value={creditsBalance} warn={creditsBalance <= 0} action={creditsBalance <= 2 ? { label: "Buy more", onClick: goToBilling } : undefined} />
              <Metric label="Ready" value={readyCount} />
              <Metric label="Developing" value={developingCount} />
            </dl>
          </div>
          <CoupleLinkCard url={coupleLink} venueReady={venueReady} />
        </section>

        {!venueReady && (
          <VenuePhotosSection
            media={media}
            venueSlug={selectedSlug}
            isUploading={isUploadingVenue || addMedia.isPending}
            uploadProgress={venueUploadProgress}
            onUpload={handleVenueUpload}
            onDelete={handleDeleteMedia}
            deletingId={deleteMedia.isPending ? (deleteMedia.variables?.mediaId ?? null) : null}
          />
        )}

        <GalleriesSection
          sessions={sessions}
          venueReady={venueReady}
          creditsBalance={creditsBalance}
          sendingSessionId={sendingSessionId}
          sentSessionId={sentSessionId}
          deletingSessionId={deleteSession.isPending ? (deleteSession.variables?.id ?? null) : null}
          onSend={handleSendGallery}
          onDelete={handleDeleteSession}
          onOpen={handleOpenGallery}
          draft={draft}
          onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onAddFiles={addDraftFiles}
          onRemoveFile={removeDraftFile}
          onStart={handleStartGallery}
          isStarting={isStarting || createSession.isPending}
          intakeOpen={intakeOpen}
          onIntakeOpenChange={setIntakeOpen}
          onBuyCredits={goToBilling}
        />

        {venueReady && (
          <VenuePhotosSection
            media={media}
            venueSlug={selectedSlug}
            isUploading={isUploadingVenue || addMedia.isPending}
            uploadProgress={venueUploadProgress}
            onUpload={handleVenueUpload}
            onDelete={handleDeleteMedia}
            deletingId={deleteMedia.isPending ? (deleteMedia.variables?.mediaId ?? null) : null}
          />
        )}

        <div ref={billingRef} className="scroll-mt-24">
          <AccountSection
            profile={profile}
            onProfileChange={(patch) => setProfile((p) => ({ ...p, ...patch }))}
            onSaveProfile={handleSaveProfile}
            saving={saving}
            dirty={profileDirty}
            organization={organization}
            onCheckout={handleCheckout}
            checkoutPending={startCheckout.isPending ? checkoutProduct : null}
            onOpenPortal={handleOpenPortal}
            portalPending={openPortal.isPending}
          />
        </div>
      </main>
    </div>
  );
}

/** Mirrors the real layout so the page doesn't jump when data lands. */
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground" aria-busy="true" aria-label="Loading dashboard">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <GlimpseLogo href="/dashboard" className="text-[1.1rem] sm:text-[1.2rem]" />
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-14 px-4 pt-8 sm:px-6 lg:pt-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <div>
            <Skeleton className="h-3 w-14 rounded-none" />
            <Skeleton className="mt-5 h-12 w-72 rounded-none" />
            <Skeleton className="mt-5 h-3 w-32 rounded-none" />
            <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-border pt-4">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-16 rounded-none" />
                  <Skeleton className="mt-3 h-10 w-12 rounded-none" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-52 w-full rounded-none" />
        </div>
        <div className="border-t border-border pt-6">
          <Skeleton className="h-3 w-20 rounded-none" />
          <Skeleton className="mt-4 h-8 w-56 rounded-none" />
          <div className="mt-8 divide-y divide-border border-y border-border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <Skeleton className="h-16 w-16 rounded-none" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-40 rounded-none" />
                  <Skeleton className="mt-2 h-3 w-64 rounded-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  warn = false,
  action,
}: {
  label: string;
  value: number;
  warn?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <dt className="mono-label text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1.5 font-display text-4xl font-medium tabular-nums tracking-tight md:text-5xl", warn ? "text-red-300" : "text-foreground")}>
        {value}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-3 align-middle font-sans text-xs tracking-normal text-rose underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
          </button>
        )}
      </dd>
    </div>
  );
}

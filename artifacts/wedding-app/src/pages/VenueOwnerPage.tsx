import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useGetVenueDashboard, 
  useGetVenueStats, 
  useListVenueMedia,
  useAddVenueMedia, 
  useDeleteVenueMedia,
  useUpdateVenue,
  useCreateBillingCheckout,
  useCreateBillingPortal,
  getGetVenueDashboardQueryKey,
  getGetVenueStatsQueryKey,
  getListVenueMediaQueryKey,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  Upload, 
  Trash2, 
  Users, 
  CheckCircle2, 
  Clock, 
  Copy,
  ExternalLink,
  Image as ImageIcon,
  QrCode,
  DollarSign,
  Bell,
  Mail,
  Eye,
  Home,
  LogOut,
  ArrowLeft,
  Settings,
  Save,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";

const MIN_VENUE_PHOTO_EDGE = 1024;
const MIN_VENUE_PHOTOS = 5;
const MAX_VENUE_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_VENUE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VENUE_MEDIA_COVERAGE_OPTIONS = [
  { value: "exterior", label: "Exterior or signature facade" },
  { value: "ceremony", label: "Ceremony space" },
  { value: "reception", label: "Reception space" },
  { value: "detail", label: "Architectural detail" },
  { value: "natural_light", label: "Best natural-light view" },
] as const;
type VenueMediaCoverage = (typeof VENUE_MEDIA_COVERAGE_OPTIONS)[number]["value"];

function validateImageDimensions(file: File, minEdge: number): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.width >= minEdge && img.height >= minEdge);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

function venueReferenceUrl(objectKey: string, venueSlug: string): string {
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

function ownerAssetUrl(objectKey: string): string {
  return `/api/storage${objectKey}`;
}

export default function VenueOwnerPage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ownerSession, setOwnerSession] = useState<string | null>(null);
  const [ownerEmailInput, setOwnerEmailInput] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [sendingSessionId, setSendingSessionId] = useState<number | null>(null);
  const [selectedCoverage, setSelectedCoverage] = useState<VenueMediaCoverage>("exterior");

  const dashboard = useGetVenueDashboard(slug!, {
    query: {
      enabled: !!ownerSession && !!slug,
      queryKey: getGetVenueDashboardQueryKey(slug!)
    },
  });

  const stats = useGetVenueStats(slug!, {
    query: {
      enabled: !!ownerSession && !!slug,
      queryKey: getGetVenueStatsQueryKey(slug!)
    },
  });

  const ownerRequest = {};

  const mediaQuery = useListVenueMedia(slug!, {
    query: {
      enabled: !!ownerSession && !!slug,
      queryKey: getListVenueMediaQueryKey(slug!),
    },
    request: ownerRequest,
  });

  const addMedia = useAddVenueMedia({ request: ownerRequest });
  const deleteMedia = useDeleteVenueMedia({ request: ownerRequest });
  const updateVenue = useUpdateVenue({ request: ownerRequest });
  const billingCheckout = useCreateBillingCheckout({ request: ownerRequest });
  const billingPortal = useCreateBillingPortal({ request: ownerRequest });
  const { uploadFile, isUploading } = useUpload({ purpose: "venue", venueSlug: slug });
  const queryClient = useQueryClient();

  const [profileName, setProfileName] = useState("");
  const [profileTagline, setProfileTagline] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileContactEmail, setProfileContactEmail] = useState("");
  const [profileContactPhone, setProfileContactPhone] = useState("");
  const [profileWebsiteUrl, setProfileWebsiteUrl] = useState("");
  const [profileBookingUrl, setProfileBookingUrl] = useState("");
  const [profileDirty, setProfileDirty] = useState(false);
  const venueMedia = mediaQuery.data?.media ?? [];
  const presentCoverage = new Set(venueMedia.map((item) => item.coverage));
  const missingCoverage = VENUE_MEDIA_COVERAGE_OPTIONS.filter(
    (option) => !presentCoverage.has(option.value),
  );
  const venueHasRequiredPhotos = venueMedia.length >= MIN_VENUE_PHOTOS && missingCoverage.length === 0;
  const sessions = dashboard.data?.sessions ?? [];
  const lastVisitKey = `venue_last_visit_${slug}`;

  const unreadCount = useMemo(() => {
    const last = localStorage.getItem(lastVisitKey);
    if (!last) return sessions.length;
    const lastMs = new Date(last).getTime();
    return sessions.filter((s) => new Date(s.createdAt).getTime() > lastMs).length;
  }, [sessions, lastVisitKey]);

  useEffect(() => {
    if (ownerSession && dashboard.data) {
      localStorage.setItem(lastVisitKey, new Date().toISOString());
    }
  }, [ownerSession, dashboard.data, lastVisitKey]);

  useEffect(() => {
    const nextMissing = missingCoverage[0]?.value;
    if (nextMissing) setSelectedCoverage(nextMissing);
  }, [missingCoverage.map((option) => option.value).join("|")]);

  // Seed profile form once dashboard data arrives (and don't clobber user edits)
  useEffect(() => {
    const v = dashboard.data?.venue;
    if (v && !profileDirty) {
      setProfileName(v.name ?? "");
      setProfileTagline(v.tagline ?? "");
      setProfileDescription(v.description ?? "");
      setProfileEmail(v.ownerEmail ?? "");
      setProfileContactEmail(v.contactEmail ?? "");
      setProfileContactPhone(v.contactPhone ?? "");
      setProfileWebsiteUrl(v.websiteUrl ?? "");
      setProfileBookingUrl(v.bookingUrl ?? "");
    }
  }, [dashboard.data, profileDirty]);

  useEffect(() => {
    fetch("/api/owners/session")
      .then((res) => {
        if (!res.ok) throw new Error("Not signed in");
        setOwnerSession("owner-session");
      })
      .catch(() => setOwnerSession(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleSendOwnerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetch("/api/owners/login-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmailInput.trim().toLowerCase() }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not send login link");
        toast({ title: "Check your email", description: "We sent a secure profile login link." });
      })
      .catch((err) =>
        toast({
          title: "Login link failed",
          description: err instanceof Error ? err.message : "Try again later.",
          variant: "destructive",
        }),
      );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!ALLOWED_VENUE_PHOTO_TYPES.has(file.type)) {
      toast({
        title: "Unsupported photo type",
        description: "Upload a JPG, PNG, or WebP venue photo.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_VENUE_PHOTO_BYTES) {
      toast({
        title: "Photo too large",
        description: "Upload venue photos up to 8MB.",
        variant: "destructive",
      });
      return;
    }
    const largeEnough = await validateImageDimensions(file, MIN_VENUE_PHOTO_EDGE);
    if (!largeEnough) {
      toast({
        title: "Photo too small",
        description: `Upload venue photos at least ${MIN_VENUE_PHOTO_EDGE}px wide and tall.`,
        variant: "destructive",
      });
      return;
    }

    const result = await uploadFile(file);
    if (result) {
      addMedia.mutate({
        slug: slug!,
        data: { objectKey: result.objectPath, coverage: selectedCoverage, displayOrder: 0 }
      }, {
        onSuccess: () => {
          void mediaQuery.refetch();
          const label =
            VENUE_MEDIA_COVERAGE_OPTIONS.find((option) => option.value === selectedCoverage)?.label ??
            "Venue reference";
          toast({ title: "Photo Uploaded", description: `${label} is now live.` });
        }
      });
    }
  };

  const handleDeleteMedia = (mediaId: number) => {
    deleteMedia.mutate({
      slug: slug!,
      mediaId
    }, {
      onSuccess: () => {
        void mediaQuery.refetch();
        toast({ title: "Photo Deleted" });
      }
    });
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const v = dashboard.data?.venue;
    if (!v) return;

    // Build a patch payload of only changed fields; backend treats undefined
    // as "leave alone" and null/"" as "clear".
    const payload: Record<string, string | null> = {};
    const trimmedName = profileName.trim();
    if (trimmedName !== (v.name ?? "")) {
      if (!trimmedName) {
        toast({ title: "Venue name cannot be empty", variant: "destructive" });
        return;
      }
      payload.name = trimmedName;
    }
    const trimmedTagline = profileTagline.trim();
    if (trimmedTagline !== (v.tagline ?? "")) {
      payload.tagline = trimmedTagline || null;
    }
    const trimmedDescription = profileDescription.trim();
    if (trimmedDescription !== (v.description ?? "")) {
      payload.description = trimmedDescription || null;
    }
    const trimmedEmail = profileEmail.trim().toLowerCase();
    if (trimmedEmail !== (v.ownerEmail ?? "")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        toast({ title: "A valid owner email is required", variant: "destructive" });
        return;
      }
      payload.ownerEmail = trimmedEmail;
    }
    const trimmedContactEmail = profileContactEmail.trim().toLowerCase();
    if (trimmedContactEmail !== (v.contactEmail ?? "")) {
      if (trimmedContactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedContactEmail)) {
        toast({ title: "Invalid public inquiry email", variant: "destructive" });
        return;
      }
      payload.contactEmail = trimmedContactEmail || null;
    }
    const trimmedContactPhone = profileContactPhone.trim();
    if (trimmedContactPhone !== (v.contactPhone ?? "")) {
      payload.contactPhone = trimmedContactPhone || null;
    }
    const trimmedWebsiteUrl = profileWebsiteUrl.trim();
    if (trimmedWebsiteUrl !== (v.websiteUrl ?? "")) {
      payload.websiteUrl = trimmedWebsiteUrl || null;
    }
    const trimmedBookingUrl = profileBookingUrl.trim();
    if (trimmedBookingUrl !== (v.bookingUrl ?? "")) {
      payload.bookingUrl = trimmedBookingUrl || null;
    }

    if (Object.keys(payload).length === 0) {
      toast({ title: "No changes to save" });
      return;
    }

    updateVenue.mutate(
      { slug: slug!, data: payload as never },
      {
        onSuccess: () => {
          setProfileDirty(false);
          toast({ title: "Profile updated" });
          void queryClient.invalidateQueries({
            queryKey: getGetVenueDashboardQueryKey(slug!),
          });
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          toast({
            title: "Update failed",
            description: err.data?.error ?? "Try again later.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const coupleUrl = `${window.location.origin}/preview/${slug}`;
  const creditsBalance = dashboard.data?.venue?.creditsBalance ?? 0;
  const venuePlan = dashboard.data?.venue?.plan ?? "trial";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      toast({ title: "Payment received", description: "Credits will update shortly." });
      void dashboard.refetch();
      window.history.replaceState({}, "", `/dashboard/${slug}`);
    }
  }, [slug, toast, dashboard]);

  const startCheckout = (product: "starter" | "growth" | "credit_pack") => {
    billingCheckout.mutate(
      { slug: slug!, data: { product } },
      {
        onSuccess: (res) => {
          window.location.href = res.url;
        },
        onError: (err: ErrorType<ErrorEnvelope>) => {
          toast({
            title: "Checkout unavailable",
            description: err.data?.error ?? "Billing is not configured.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const openBillingPortal = () => {
    billingPortal.mutate(
      { slug: slug! },
      {
        onSuccess: (res) => {
          window.location.href = res.url;
        },
        onError: () => {
          toast({ title: "Portal unavailable", variant: "destructive" });
        },
      },
    );
  };

  const handleOwnerPreview = () => {
    if (!venueHasRequiredPhotos) {
      toast({
        title: "Add venue photos first",
        description: `Upload at least ${MIN_VENUE_PHOTOS} venue photos before previewing the couple page.`,
        variant: "destructive",
      });
      return;
    }
    setLocation(`/preview/${slug}`);
  };

  const openQrPanel = () => {
    if (!venueHasRequiredPhotos) {
      toast({
        title: "Venue setup incomplete",
        description: `Upload at least ${MIN_VENUE_PHOTOS} venue photos before sharing your couple QR.`,
        variant: "destructive",
      });
      return;
    }
    setShowQr(true);
  };

  const copyShareLink = () => {
    if (!venueHasRequiredPhotos) {
      toast({
        title: "Venue setup incomplete",
        description: `Upload at least ${MIN_VENUE_PHOTOS} venue photos before sharing your couple link.`,
        variant: "destructive",
      });
      return;
    }
    if (creditsBalance <= 0) {
      toast({
        title: "No credits remaining",
        description: "Add credits before sharing your couple link.",
        variant: "destructive",
      });
      return;
    }
    navigator.clipboard.writeText(coupleUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link Copied", description: "Share this with your couples." });
    }).catch(() => {
      toast({ title: "Could not copy", description: coupleUrl, variant: "destructive" });
    });
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!ownerSession) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
        <Button
          variant="ghost"
          className="absolute top-6 left-6 text-muted-foreground hover:text-foreground"
          onClick={() => setLocation("/")}
          data-testid="owner-gate-home"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="glass w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="serif text-3xl">Owner Sign In</CardTitle>
              <CardDescription>
                Enter the owner email for{" "}
                <span className="font-medium text-foreground">{slug}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendOwnerLogin} className="space-y-4">
                <Input
                  type="email"
                  placeholder="owner@example.com"
                  className="text-center bg-background/50 border-border"
                  value={ownerEmailInput}
                  onChange={(e) => setOwnerEmailInput(e.target.value)}
                  autoFocus
                  data-testid="owner-email-input"
                />
                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground"
                  disabled={!ownerEmailInput.trim()}
                  data-testid="owner-login-submit"
                >
                  Send secure login link
                </Button>
                <div className="flex items-center justify-between pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setLocation("/create-venue")}
                    className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    data-testid="owner-gate-create"
                  >
                    Don't have a venue? Create one
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocation("/")}
                    className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    data-testid="owner-gate-different"
                  >
                    Switch venue
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  const handleLogout = () => {
    void fetch("/api/owners/logout", { method: "POST" });
    setOwnerSession(null);
    setOwnerEmailInput("");
    toast({
      title: "Logged out",
      description: "Use a fresh email link to access the dashboard again.",
    });
  };

  if (dashboard.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const venue = dashboard.data?.venue ?? null;

  const handleSendToCouple = async (sessionId: number, coupleEmail?: string | null) => {
    if (!coupleEmail) {
      toast({
        title: "No email on file",
        description: "This couple did not provide an email during their session.",
        variant: "destructive",
      });
      return;
    }
    if (!ownerSession) {
      toast({ title: "Not authenticated", variant: "destructive" });
      return;
    }
    setSendingSessionId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: coupleEmail }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast({
        title: data.sent ? "Email sent" : "Email not sent",
        description: data.sent
          ? `Link sent to ${coupleEmail}`
          : "Email service is not configured.",
        variant: data.sent ? "default" : "destructive",
      });
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Try again later.",
        variant: "destructive",
      });
    } finally {
      setSendingSessionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header Bar */}
      <header className="border-b border-border bg-card/30 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div>
            <h1 className="serif text-2xl font-semibold">{venue?.name}</h1>
            <Badge variant="outline" className="text-secondary border-secondary/30">Owner Dashboard</Badge>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {unreadCount > 0 && (
              <Badge className="bg-primary/20 text-primary border-primary/30 flex items-center gap-1">
                <Bell className="h-3 w-3" />
                {unreadCount} new
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleOwnerPreview}
              disabled={!venueHasRequiredPhotos}
              className="border-border"
              title={
                venueHasRequiredPhotos
                  ? "Preview the couple page"
                  : `Upload at least ${MIN_VENUE_PHOTOS} venue photos first`
              }
              data-testid="preview-mode-button"
            >
              <Eye className="mr-2 h-4 w-4" />
              Couple Page
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={openQrPanel}
              className="bg-primary text-primary-foreground"
              title={
                venueHasRequiredPhotos
                  ? "Open the couple QR"
                  : `Upload at least ${MIN_VENUE_PHOTOS} venue photos first`
              }
              data-testid="qr-primary-cta"
            >
              <QrCode className="mr-2 h-4 w-4" /> Couple QR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyShareLink}
              className="border-border"
              title={
                venueHasRequiredPhotos
                  ? "Copy the couple link"
                  : `Upload at least ${MIN_VENUE_PHOTOS} venue photos first`
              }
            >
              {copied ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation(`/preview/${slug}`)} className="text-muted-foreground hidden sm:flex" data-testid="dashboard-view-public">
              <ExternalLink className="mr-2 h-4 w-4" /> View Public
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="text-muted-foreground"
              data-testid="dashboard-home"
            >
              <Home className="mr-2 h-4 w-4" />
              <span className="hidden md:inline">Home</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-destructive"
              data-testid="dashboard-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span className="hidden md:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* QR Code Panel */}
      <AnimatePresence>
        {showQr && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="border-b border-border bg-card/40 backdrop-blur-md"
          >
            <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center gap-6">
              <div className="rounded-xl overflow-hidden bg-white p-3 shadow-lg shrink-0">
                <QRCodeSVG value={coupleUrl} size={160} level="M" />
              </div>
              <div className="text-center sm:text-left">
                <h3 className="serif text-xl font-semibold mb-1">Couple Experience Link</h3>
                <p className="text-muted-foreground text-sm mb-3">
                  Show this QR code on your iPad during venue visits, or send the link directly. Couples can scan it to start uploading their photos instantly.
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <code className="text-xs bg-background/50 border border-border rounded-lg px-3 py-2 font-mono text-muted-foreground break-all">
                    {coupleUrl}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyShareLink} className="shrink-0 border-border">
                    {copied ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-8">
        <Card className={`border-border ${creditsBalance <= 0 ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
          <CardHeader>
            <CardTitle className="serif flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-secondary" />
              Credits & Billing
            </CardTitle>
            <CardDescription>
              {creditsBalance <= 0
                ? "You're out of credits. Couples cannot start new previews until you upgrade."
                : `${creditsBalance} credit${creditsBalance === 1 ? "" : "s"} remaining - Plan: ${venuePlan}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => startCheckout("starter")} disabled={billingCheckout.isPending}>
              Starter $149/mo
            </Button>
            <Button size="sm" variant="secondary" onClick={() => startCheckout("growth")} disabled={billingCheckout.isPending}>
              Growth $399/mo
            </Button>
            <Button size="sm" variant="outline" onClick={() => startCheckout("credit_pack")} disabled={billingCheckout.isPending}>
              +10 credits $49
            </Button>
            <Button size="sm" variant="ghost" onClick={openBillingPortal} disabled={billingPortal.isPending}>
              Manage subscription
            </Button>
            {dashboard.data?.venue?.billingPeriodEnd && (
              <span className="text-xs text-muted-foreground w-full mt-1">
                Renews {new Date(dashboard.data.venue.billingPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard
            label="Total Sessions"
            value={stats.data?.totalSessions ?? 0}
            icon={<Users className="h-5 w-5 text-blue-400" />}
          />
          <StatCard
            label="Ready"
            value={stats.data?.readySessions ?? 0}
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          />
          <StatCard
            label="Processing"
            value={stats.data?.processingSessions ?? 0}
            icon={<Clock className="h-5 w-5 text-amber-400" />}
          />
          <StatCard
            label="Est. AI Cost"
            value={`$${(stats.data?.totalEstimatedCostUsd ?? 0).toFixed(2)}`}
            icon={<DollarSign className="h-5 w-5 text-rose-400" />}
          />
        </div>

        {/* Venue Photos */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="serif text-2xl">Venue Photos</h2>
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isUploading || addMedia.isPending}
              className="bg-secondary text-secondary-foreground"
            >
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload Photo
            </Button>
            <input
              type="file"
              hidden
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/jpeg,image/png,image/webp"
            />
          </div>

          <Card className="border-border/60 bg-muted/20">
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Add high-resolution photos for each coverage type so generated galleries stay anchored to the exact parts of your venue.
                {" "}
                <span className="font-medium text-foreground">
                  {VENUE_MEDIA_COVERAGE_OPTIONS.length - missingCoverage.length}/{VENUE_MEDIA_COVERAGE_OPTIONS.length} coverage slots ready.
                </span>
              </p>
              <div className="grid sm:grid-cols-5 gap-2 text-xs">
                {VENUE_MEDIA_COVERAGE_OPTIONS.map((option, index) => {
                  const complete = presentCoverage.has(option.value);
                  const selected = selectedCoverage === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedCoverage(option.value)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : complete
                            ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
                            : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`venue-coverage-${option.value}`}
                    >
                      <span className="font-medium">{index + 1}.</span> {option.label}
                      <span className="mt-1 block text-[10px] uppercase tracking-widest">
                        {complete ? "Added" : selected ? "Selected" : "Needed"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                New uploads will be saved as{" "}
                <span className="font-medium text-foreground">
                  {VENUE_MEDIA_COVERAGE_OPTIONS.find((option) => option.value === selectedCoverage)?.label}
                </span>
                . Choose a different slot before uploading if needed.
              </p>
              {missingCoverage.length > 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Couples can start galleries after all coverage slots are added:{" "}
                  {missingCoverage.map((option) => option.label).join(", ")}.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <AnimatePresence>
              {venueMedia.map((item) => {
                const coverageLabel =
                  VENUE_MEDIA_COVERAGE_OPTIONS.find((option) => option.value === item.coverage)?.label ??
                  "Venue reference";
                return (
                  <motion.div 
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="relative group aspect-square rounded-lg overflow-hidden border border-border"
                  >
                    <img 
                      src={venueReferenceUrl(item.objectKey, slug!)}
                      alt={coverageLabel}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <Badge className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate bg-background/90 text-foreground border border-border">
                      {coverageLabel}
                    </Badge>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button 
                        variant="destructive" 
                        size="icon" 
                        className="rounded-full"
                        onClick={() => handleDeleteMedia(item.id)}
                        data-testid={`delete-media-${item.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>

        {/* Venue Profile */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-secondary" />
            <h2 className="serif text-2xl">Venue Profile</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="glass border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">Public Details</CardTitle>
                <CardDescription>
                  This is what couples see when they open your venue page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-name">Venue name</Label>
                    <Input
                      id="profile-name"
                      value={profileName}
                      onChange={(e) => {
                        setProfileName(e.target.value);
                        setProfileDirty(true);
                      }}
                      className="bg-background/60 border-border"
                      data-testid="profile-name-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-tagline">Tagline</Label>
                    <Input
                      id="profile-tagline"
                      placeholder="A short, evocative one-liner"
                      value={profileTagline}
                      onChange={(e) => {
                        setProfileTagline(e.target.value);
                        setProfileDirty(true);
                      }}
                      maxLength={120}
                      className="bg-background/60 border-border"
                      data-testid="profile-tagline-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-description">Description</Label>
                    <Textarea
                      id="profile-description"
                      placeholder="Describe what makes your venue special; this guides the gallery style."
                      value={profileDescription}
                      onChange={(e) => {
                        setProfileDescription(e.target.value);
                        setProfileDirty(true);
                      }}
                      maxLength={1000}
                      rows={4}
                      className="bg-background/60 border-border resize-none"
                      data-testid="profile-description-input"
                    />
                    <p className="text-[11px] text-muted-foreground text-right">
                      {profileDescription.length}/1000
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-email">Recovery & notifications email</Label>
                    <Input
                      id="profile-email"
                      type="email"
                      required
                      placeholder="owner@example.com"
                      value={profileEmail}
                      onChange={(e) => {
                        setProfileEmail(e.target.value);
                        setProfileDirty(true);
                      }}
                      className="bg-background/60 border-border"
                      data-testid="profile-email-input"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Used for session notifications and to recover your
                      profile link if you forget your venue code.
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-contact-email">Public inquiry email</Label>
                      <Input
                        id="profile-contact-email"
                        type="email"
                        placeholder="events@example.com"
                        value={profileContactEmail}
                        onChange={(e) => {
                          setProfileContactEmail(e.target.value);
                          setProfileDirty(true);
                        }}
                        className="bg-background/60 border-border"
                        data-testid="profile-contact-email-input"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-contact-phone">Public phone</Label>
                      <Input
                        id="profile-contact-phone"
                        placeholder="(555) 123-4567"
                        value={profileContactPhone}
                        onChange={(e) => {
                          setProfileContactPhone(e.target.value);
                          setProfileDirty(true);
                        }}
                        className="bg-background/60 border-border"
                        data-testid="profile-contact-phone-input"
                      />
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-website-url">Website URL</Label>
                      <Input
                        id="profile-website-url"
                        placeholder="https://yourvenue.com"
                        value={profileWebsiteUrl}
                        onChange={(e) => {
                          setProfileWebsiteUrl(e.target.value);
                          setProfileDirty(true);
                        }}
                        className="bg-background/60 border-border"
                        data-testid="profile-website-url-input"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-booking-url">Tour booking URL</Label>
                      <Input
                        id="profile-booking-url"
                        placeholder="https://yourvenue.com/tours"
                        value={profileBookingUrl}
                        onChange={(e) => {
                          setProfileBookingUrl(e.target.value);
                          setProfileDirty(true);
                        }}
                        className="bg-background/60 border-border"
                        data-testid="profile-booking-url-input"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    These public details appear on ready galleries so couples can book a tour or contact your team.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    {profileDirty && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const v = dashboard.data?.venue;
                          if (v) {
                            setProfileName(v.name ?? "");
                            setProfileTagline(v.tagline ?? "");
                            setProfileDescription(v.description ?? "");
                            setProfileEmail(v.ownerEmail ?? "");
                            setProfileContactEmail(v.contactEmail ?? "");
                            setProfileContactPhone(v.contactPhone ?? "");
                            setProfileWebsiteUrl(v.websiteUrl ?? "");
                            setProfileBookingUrl(v.bookingUrl ?? "");
                            setProfileDirty(false);
                          }
                        }}
                        data-testid="profile-reset"
                      >
                        Discard
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={updateVenue.isPending || !profileDirty}
                      className="bg-secondary text-secondary-foreground"
                      data-testid="profile-save"
                    >
                      {updateVenue.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save Changes
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="glass border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <LogOut className="h-5 w-5 text-secondary" />
                  Secure owner access
                </CardTitle>
                <CardDescription>
                  Dashboard access is protected by one-time email login links and an httpOnly session cookie.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleLogout} className="w-full">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out of this device
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Couple Sessions */}
        <section className="space-y-4">
          <h2 className="serif text-2xl">Couple Sessions</h2>
          <Card className="glass">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/50 text-sm font-medium text-muted-foreground">
                    <th className="px-6 py-4">Thumbnail</th>
                    <th className="px-6 py-4">Session ID</th>
                    <th className="px-6 py-4">Couple</th>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Length</th>
                    <th className="px-6 py-4">Est. Cost</th>
                    <th className="px-6 py-4">Created At</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                        No sessions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((session) => (
                      <tr key={session.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4">
                          <div className="h-12 w-12 rounded bg-muted overflow-hidden">
                            {session.thumbnailObjectKey ? (
                              <img
                                src={ownerAssetUrl(session.thumbnailObjectKey)}
                                alt="Session"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">#{session.id}</td>
                        <td className="px-6 py-4 text-sm">
                          {session.coupleName ?? "-"}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground max-w-[140px] truncate">
                          {session.coupleEmail ?? "-"}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant="secondary"
                            className={
                              session.status === "ready" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              session.status === "processing" ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse" :
                              session.status === "failed" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              "bg-slate-500/10 text-slate-400 border-slate-500/20"
                            }
                          >
                            {session.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          Gallery
                        </td>
                        <td className="px-6 py-4 text-sm serif text-secondary">
                          ${(session.estimatedCostUsd ?? 0).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-1">
                            {session.status === "ready" && session.shareToken && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const url = `${window.location.origin}/v/${session.shareToken}`;
                                  navigator.clipboard.writeText(url);
                                  toast({ title: "Link copied" });
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!session.coupleEmail || sendingSessionId === session.id}
                              onClick={() => handleSendToCouple(session.id, session.coupleEmail)}
                              data-testid={`send-couple-${session.id}`}
                            >
                              {sendingSessionId === session.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Mail className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <Card className="glass border-border/50 overflow-hidden relative">
      <div className="absolute top-0 right-0 p-4 opacity-20">{icon}</div>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider font-medium">{label}</CardDescription>
        <CardTitle className="text-4xl font-light">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}


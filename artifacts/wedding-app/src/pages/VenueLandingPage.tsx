import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  Check,
  Copy,
  ImageUp,
  LayoutDashboard,
  Link as LinkIcon,
  Loader2,
  LogIn,
  Mail,
  QrCode,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useRecoverOwnerVenues } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { VenueSiteHeader } from "@/components/layout/VenueSiteHeader";
import { useToast } from "@/hooks/use-toast";
import { toVenueSlug } from "@/lib/venueSlug";

const HERO_IMAGE = "/brand/venue-landing-hero.png";

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerSlugInput, setOwnerSlugInput] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverSent, setRecoverSent] = useState(false);
  const [sampleVenue, setSampleVenue] = useState("rosewood-estate");
  const recoverMutation = useRecoverOwnerVenues();

  const sampleSlug = toVenueSlug(sampleVenue) || "rosewood-estate";
  const sampleCoupleLink = useMemo(() => `/preview/${sampleSlug}`, [sampleSlug]);
  const sampleProfileLink = useMemo(() => `/profile/${sampleSlug}`, [sampleSlug]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("owner") !== "sign-in") return;
    setOwnerOpen(true);
    params.delete("owner");
    const nextSearch = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, []);

  const resetOwnerDialog = () => {
    setRecoverSent(false);
    setRecoverEmail("");
    setOwnerSlugInput("");
  };

  const handleOwnerSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = toVenueSlug(ownerSlugInput);
    if (!slug) return;
    setOwnerOpen(false);
    resetOwnerDialog();
    setLocation(`/profile/${slug}`);
  };

  const handleEmailRecover = (e: React.FormEvent) => {
    e.preventDefault();
    const email = recoverEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid owner email address.",
        variant: "destructive",
      });
      return;
    }

    recoverMutation.mutate(
      { data: { email } },
      {
        onSuccess: () => setRecoverSent(true),
        onError: () => setRecoverSent(true),
      },
    );
  };

  const copySampleLink = () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const fullUrl = `${origin}${sampleCoupleLink}`;
    void navigator.clipboard?.writeText(fullUrl);
    toast({
      title: "Couple link copied",
      description: fullUrl,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <VenueSiteHeader onSignIn={() => setOwnerOpen(true)} />

      <section
        className="relative isolate min-h-[calc(100svh-8rem)] overflow-hidden border-b border-border bg-foreground px-4 py-10 text-background sm:py-12"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(22, 20, 18, 0.84) 0%, rgba(22, 20, 18, 0.7) 42%, rgba(22, 20, 18, 0.34) 100%), url(${HERO_IMAGE})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="max-w-6xl mx-auto grid min-h-[calc(100svh-14rem)] lg:grid-cols-[minmax(0,0.95fr)_minmax(380px,0.78fr)] gap-8 items-end">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65 }}
            className="max-w-2xl pb-2 lg:pb-6"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-primary mb-4 drop-shadow">
              Venue command center
            </p>
            <h1 className="serif text-5xl sm:text-6xl lg:text-7xl text-background mb-5 tracking-normal font-medium leading-[0.98] drop-shadow">
              Give every tour couple a gallery built inside your venue
            </h1>
            <p className="text-lg text-background/78 max-w-xl mb-8 font-light leading-relaxed">
              glimpse is the main site for venues: create a profile, manage the
              spaces and credits behind it, then share one private couple gateway
              for branded likeness-focused galleries.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Button
                type="button"
                size="lg"
                onClick={() => setLocation("/create-venue")}
                className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="venue-hero-register"
              >
                Start venue profile <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <Dialog
                open={ownerOpen}
                onOpenChange={(open) => {
                  setOwnerOpen(open);
                  if (!open) resetOwnerDialog();
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="lg"
                    className="px-8 border-background/40 bg-background/10 text-background hover:bg-background hover:text-foreground"
                    data-testid="owner-cta"
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    Access profile
                  </Button>
                </DialogTrigger>
                <OwnerAccessDialog
                  ownerSlugInput={ownerSlugInput}
                  setOwnerSlugInput={setOwnerSlugInput}
                  recoverEmail={recoverEmail}
                  setRecoverEmail={setRecoverEmail}
                  recoverSent={recoverSent}
                  setRecoverSent={setRecoverSent}
                  recoverMutationPending={recoverMutation.isPending}
                  onSubmitSlug={handleOwnerSignIn}
                  onRecover={handleEmailRecover}
                  onCreateVenue={() => {
                    setOwnerOpen(false);
                    resetOwnerDialog();
                    setLocation("/create-venue");
                  }}
                />
              </Dialog>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              {[
                ["Register", "/create-venue"],
                ["Owner profile", "/profile/your-venue"],
                ["Couple gateway", "/preview/your-venue"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-background/20 bg-background/10 p-4 backdrop-blur-sm">
                  <p className="text-xs uppercase tracking-widest text-background/60 mb-1">
                    {label}
                  </p>
                  <p className="font-medium text-background">{value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="pb-2 lg:pb-6"
          >
            <div className="rounded-lg border border-background/20 bg-background/95 p-4 text-foreground shadow-2xl backdrop-blur-md">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                    Link builder
                  </p>
                  <h2 className="serif text-2xl">Your venue profile routes</h2>
                </div>
                <div className="rounded-md bg-primary/10 p-3 text-primary">
                  <QrCode className="h-7 w-7" />
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={sampleVenue}
                  onChange={(e) => setSampleVenue(e.target.value)}
                  className="bg-background border-border font-mono text-sm"
                  aria-label="Example venue slug"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-border"
                  onClick={copySampleLink}
                  data-testid="copy-example-couple-link"
                  aria-label="Copy example couple link"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                <LinkRow
                  icon={<LayoutDashboard className="h-4 w-4" />}
                  label="Owner profile"
                  value={sampleProfileLink}
                  detail="Secure setup, media, billing, QR codes, and couple sessions."
                />
                <LinkRow
                  icon={<LinkIcon className="h-4 w-4" />}
                  label="Couple gateway"
                  value={sampleCoupleLink}
                  detail="Public preview link for tours, open houses, ads, and follow-up emails."
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {[
                  ["5+", "venue refs"],
                  ["4", "stills"],
                  ["1", "motion reel"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-md border border-border bg-muted/35 px-2 py-3">
                    <p className="text-xl font-light text-foreground">{value}</p>
                    <p className="text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-border"
                  onClick={() => setOwnerOpen(true)}
                  data-testid="open-owner-access-from-builder"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  Access profile
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setLocation("/create-venue")}
                  data-testid="builder-create-venue"
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  Register venue
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="px-4 -mt-8 relative z-10">
        <div className="max-w-6xl mx-auto rounded-lg border border-border bg-card p-4 shadow-xl">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                icon: <Building2 className="h-5 w-5" />,
                title: "Venue sign-up",
                desc: "Create the profile, owner email, sales CTA, and starting trial credits.",
              },
              {
                icon: <LayoutDashboard className="h-5 w-5" />,
                title: "Individual profile",
                desc: "Owners return to their dashboard by email login or venue code.",
              },
              {
                icon: <LinkIcon className="h-5 w-5" />,
                title: "Couple link",
                desc: "Each dashboard gives the venue a preview URL and QR to share.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-3 rounded-md bg-background/70 p-4">
                <div className="mt-1 text-primary">{item.icon}</div>
                <div>
                  <h2 className="font-medium text-foreground">{item.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-foreground text-background">
        <div className="max-w-6xl mx-auto px-4 py-8 grid md:grid-cols-3 gap-5">
          {[
            {
              icon: <Building2 className="h-5 w-5" />,
              title: "Individual venue profiles",
              desc: "Each venue gets an authenticated profile dashboard plus a public couple preview URL.",
            },
            {
              icon: <LayoutDashboard className="h-5 w-5" />,
              title: "Private owner profile",
              desc: "Owners manage profile details, media, billing, links, and every couple gallery tied to that venue.",
            },
            {
              icon: <ShieldCheck className="h-5 w-5" />,
              title: "Couple-safe sharing",
              desc: "Couples only receive preview and gallery URLs, never onboarding or admin routes.",
            },
          ].map((item) => (
            <div key={item.title} className="flex gap-4">
              <div className="mt-1 text-primary">{item.icon}</div>
              <div>
                <h2 className="text-base font-medium mb-1">{item.title}</h2>
                <p className="text-sm text-background/70 font-light leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">
                Venue workflow
              </p>
              <h2 className="serif text-4xl text-foreground">From signup to booked tour follow-up</h2>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-border md:self-center"
              onClick={() => setOwnerOpen(true)}
            >
              <LogIn className="mr-2 h-4 w-4" />
              Access existing profile
            </Button>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            {[
              {
                icon: <Building2 className="h-6 w-6" />,
                title: "Create the venue",
                desc: "Register the profile, owner email, venue slug, public CTA, and starting brand copy.",
              },
              {
                icon: <ImageUp className="h-6 w-6" />,
                title: "Upload real spaces",
                desc: "Add facade, ceremony, reception, details, and best natural-light views.",
              },
              {
                icon: <LinkIcon className="h-6 w-6" />,
                title: "Share the couple link",
                desc: "Copy the preview URL or QR from the profile dashboard for tours, ads, emails, and open houses.",
              },
              {
                icon: <CalendarCheck className="h-6 w-6" />,
                title: "Convert the moment",
                desc: "Couples receive branded galleries with a clear tour/contact CTA back to you.",
              },
            ].map((step, index) => (
              <Card key={step.title} className="bg-card border-border h-full">
                <CardContent className="pt-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="rounded-md bg-primary/10 p-3 text-primary">{step.icon}</div>
                    <span className="text-xs font-medium text-muted-foreground">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="serif text-xl mb-3">{step.title}</h3>
                  <p className="text-sm text-muted-foreground font-light leading-relaxed">{step.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4 bg-muted/35 border-y border-border/70">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.9fr_1.1fr] gap-8 items-start">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">
              What venues get
            </p>
            <h2 className="serif text-4xl mb-4">A profile hub and a couple gateway</h2>
            <p className="text-muted-foreground font-light leading-relaxed">
              The main site is for venue operators. It lets them register, return to
              each individual profile, manage media, and distribute a couple-facing
              gallery experience designed to increase tour confidence.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {[
              {
                title: "Profile management",
                desc: "Venue name, description, contact CTA, owner email, billing status, credits, and couple-link tools.",
              },
              {
                title: "Media readiness",
                desc: "Owners must add at least five venue photos before couples can start galleries.",
              },
              {
                title: "Session oversight",
                desc: "Profile dashboards show each couple session, status, gallery assets, email, and share link.",
              },
              {
                title: "Sales handoff",
                desc: "Ready galleries lead couples back to the venue with booking and contact prompts.",
              },
            ].map((feature) => (
              <div key={feature.title} className="rounded-lg border border-border bg-card p-5">
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Check className="h-4 w-4" />
                </div>
                <h3 className="font-medium mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground font-light leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_0.9fr] gap-8 items-start">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary mb-3">
              Pricing
            </p>
            <h2 className="serif text-4xl mb-4">Start free, scale with tour volume</h2>
            <p className="text-muted-foreground font-light max-w-xl">
              V1 keeps self-serve venue onboarding with trial credits, subscriptions,
              and credit packs so the venue can control how many galleries couples make.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-4">
            {[
              ["Trial", "Free", "5 galleries"],
              ["Starter", "$149/mo", "25 galleries"],
              ["Growth", "$399/mo", "100 galleries"],
            ].map(([name, price, credits]) => (
              <Card key={name} className="border-border bg-card">
                <CardContent className="pt-6">
                  <h3 className="serif text-2xl mb-1">{name}</h3>
                  <p className="text-2xl font-light">{price}</p>
                  <p className="text-sm text-primary mt-2">{credits}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="max-w-6xl mx-auto rounded-lg border border-border bg-foreground text-background p-8 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              <span className="text-xs uppercase tracking-[0.2em]">glimpse</span>
            </div>
            <h2 className="serif text-3xl md:text-4xl mb-2">Ready to give couples their link?</h2>
            <p className="text-background/70 font-light max-w-xl">
              Create the venue profile, add your space references, then share the
              couple preview URL from the venue dashboard.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            <Button
              type="button"
              size="lg"
              onClick={() => setLocation("/create-venue")}
              className="bg-primary text-primary-foreground"
            >
              Register venue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setOwnerOpen(true)}
              className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign in
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface OwnerAccessDialogProps {
  ownerSlugInput: string;
  setOwnerSlugInput: (value: string) => void;
  recoverEmail: string;
  setRecoverEmail: (value: string) => void;
  recoverSent: boolean;
  setRecoverSent: (value: boolean) => void;
  recoverMutationPending: boolean;
  onSubmitSlug: (e: React.FormEvent) => void;
  onRecover: (e: React.FormEvent) => void;
  onCreateVenue: () => void;
}

interface LinkRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}

function LinkRow({ icon, label, value, detail }: LinkRowProps) {
  return (
    <div className="rounded-md border border-border/80 bg-background/65 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="truncate font-mono text-sm text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function OwnerAccessDialog({
  ownerSlugInput,
  setOwnerSlugInput,
  recoverEmail,
  setRecoverEmail,
  recoverSent,
  setRecoverSent,
  recoverMutationPending,
  onSubmitSlug,
  onRecover,
  onCreateVenue,
}: OwnerAccessDialogProps) {
  return (
    <DialogContent className="sm:max-w-md bg-card border-border">
      <DialogHeader>
        <DialogTitle className="serif text-2xl">Access venue profile</DialogTitle>
        <p className="text-sm text-muted-foreground font-light">
          Enter a venue code to open its owner profile, or recover all venue links by
          owner email.
        </p>
      </DialogHeader>

      <form onSubmit={onSubmitSlug} className="space-y-3">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Venue code
        </label>
        <div className="flex gap-2">
          <Input
            placeholder="your-venue-slug"
            value={ownerSlugInput}
            onChange={(e) => setOwnerSlugInput(e.target.value)}
            className="bg-background border-border"
            data-testid="owner-slug-input"
            autoFocus
          />
          <Button
            type="submit"
            disabled={!toVenueSlug(ownerSlugInput)}
            className="bg-primary text-primary-foreground shrink-0"
            data-testid="owner-slug-submit"
          >
            Open <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          We email a secure sign-in link to the owner address before profile data opens.
        </p>
      </form>

      <Separator className="my-2" />

      {recoverSent ? (
        <div
          className="text-sm bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3 text-emerald-800 dark:text-emerald-200"
          data-testid="owner-recover-success"
        >
          <p className="font-medium">Check your inbox</p>
          <p className="text-xs mt-1 opacity-80">
            If that email owns any venues, the message includes secure profile links.
          </p>
          <Button
            variant="link"
            className="px-0 h-auto"
            onClick={() => {
              setRecoverSent(false);
              setRecoverEmail("");
            }}
          >
            Send to a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={onRecover} className="space-y-3">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">
            Recover profile links
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="owner@example.com"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                className="bg-background border-border pl-10"
                data-testid="owner-recover-email"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={recoverMutationPending || !recoverEmail.trim()}
              data-testid="owner-recover-submit"
            >
              {recoverMutationPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      )}

      <Separator className="my-2" />

      <div className="text-center">
        <Button
          variant="link"
          onClick={onCreateVenue}
          className="text-primary"
          data-testid="owner-dialog-create"
        >
          New here? Register your venue
        </Button>
      </div>
    </DialogContent>
  );
}

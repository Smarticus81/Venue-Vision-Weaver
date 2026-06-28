import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Loader2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toVenueSlug } from "@/lib/venueSlug";

export default function CreateVenuePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    ownerEmail: "",
    password: "",
    bookingUrl: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ownerEmail = formData.ownerEmail.trim().toLowerCase();
    const slug = toVenueSlug(formData.name);

    if (!slug) {
      toast({ title: "Venue name required", variant: "destructive" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      toast({ title: "Valid owner email required", variant: "destructive" });
      return;
    }
    if (formData.password.length < 8) {
      toast({
        title: "Use a longer password",
        description: "Passwords must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          slug,
          ownerEmail,
          password: formData.password,
          contactEmail: ownerEmail,
          bookingUrl: formData.bookingUrl.trim() || undefined,
          tagline: "Personal AI galleries that help tour couples picture the day here.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create venue.");
      toast({
        title: "Venue created",
        description: "Your dashboard is ready.",
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "Creation failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(135deg,#f8fbff_0%,#f6eef5_46%,#edf8f5_100%)] text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(255,255,255,0.88),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(204,234,255,0.68),transparent_29%),radial-gradient(circle_at_58%_86%,rgba(255,230,238,0.76),transparent_31%)]" />
      <main className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-4 py-8 lg:grid-cols-[0.9fr_440px]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="hidden lg:block"
        >
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mb-10 inline-flex items-center gap-2 text-sm text-foreground/60 transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Glimpse
          </button>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/45 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-2xl">
            <Sparkles className="h-4 w-4 text-sky-500" />
            Venue conversion
          </div>
          <h1 className="max-w-2xl text-6xl font-semibold leading-[0.95] tracking-normal text-[#111318]">
            Create the workspace that turns tours into yes.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-foreground/62">
            Upload the venue once. Every ready gallery becomes a private,
            email-delivered follow-up for the couple.
          </p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="rounded-lg border border-white/65 bg-white/58 p-5 shadow-[0_30px_90px_rgba(31,41,55,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-3xl"
        >
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="mb-6 inline-flex items-center gap-2 text-sm text-foreground/55 transition hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </button>

          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#111318] text-white shadow-lg">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="text-3xl font-semibold tracking-normal">Create venue</h2>
            <p className="mt-2 text-sm leading-6 text-foreground/58">
              Set up the owner login and dashboard in under a minute.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="venue-name">Venue name</Label>
              <Input
                id="venue-name"
                required
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="h-12 border-white/80 bg-white/64 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                placeholder="The Willow House"
                data-testid="venue-name-input"
                autoComplete="organization"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner-email">Owner email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/38" />
                <Input
                  id="owner-email"
                  type="email"
                  required
                  value={formData.ownerEmail}
                  onChange={(e) => setFormData((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                  className="h-12 border-white/80 bg-white/64 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  placeholder="owner@venue.com"
                  data-testid="venue-owner-email-input"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner-password">Password</Label>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/38" />
                <Input
                  id="owner-password"
                  type="password"
                  required
                  minLength={8}
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  className="h-12 border-white/80 bg-white/64 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                  placeholder="At least 8 characters"
                  data-testid="venue-password-input"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="booking-url">Tour booking link</Label>
              <Input
                id="booking-url"
                value={formData.bookingUrl}
                onChange={(e) => setFormData((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                className="h-12 border-white/80 bg-white/64 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                placeholder="https://yourvenue.com/tours"
                data-testid="venue-booking-url-input"
                autoComplete="url"
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full bg-[#111318] text-white hover:bg-[#252932]"
              data-testid="create-venue-submit"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enter dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            onClick={() => setLocation("/login")}
            className="mt-4 w-full text-foreground/62 hover:text-foreground"
            data-testid="venue-existing-login"
          >
            Already have an account?
          </Button>
        </motion.section>
      </main>
    </div>
  );
}

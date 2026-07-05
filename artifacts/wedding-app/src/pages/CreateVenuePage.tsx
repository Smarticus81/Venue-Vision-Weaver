import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toVenueSlug } from "@/lib/venueSlug";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

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
          tagline: "Photoreal preview galleries that help prospects visualize the day and inquire faster.",
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
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="absolute top-0 w-full p-6 sm:p-10 flex items-center justify-between z-10">
        <GlimpseLogo href="/" />
        <Button variant="ghost" onClick={() => setLocation("/")} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to site
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 relative py-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--rose)/0.06),transparent_50%)] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md mt-10"
        >
          <div className="bg-card rounded-xl border border-card-border p-8 sm:p-10 shadow-xl shadow-black/40 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-rose/20" />

            <div className="mb-8">
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-6 text-rose border border-border">
                <Building2 className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Create venue workspace</h1>
              <p className="mt-2 text-muted-foreground font-light">
                Build the conversion hub for branded preview galleries, tour CTAs, and owner-approved follow-up.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="venue-name" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Venue name</Label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="venue-name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-border bg-background focus-visible:ring-ring"
                    placeholder="The Willow House"
                    data-testid="venue-name-input"
                    autoComplete="organization"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-email" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Owner email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="owner-email"
                    type="email"
                    required
                    value={formData.ownerEmail}
                    onChange={(e) => setFormData((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-border bg-background focus-visible:ring-ring"
                    placeholder="owner@venue.com"
                    data-testid="venue-owner-email-input"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-password" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Password</Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="owner-password"
                    type="password"
                    required
                    minLength={8}
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-border bg-background focus-visible:ring-ring"
                    placeholder="At least 8 characters"
                    data-testid="venue-password-input"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="booking-url" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tour booking link <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                  id="booking-url"
                  value={formData.bookingUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                  className="h-12 rounded-xl border-border bg-background focus-visible:ring-ring"
                  placeholder="https://yourvenue.com/tours"
                  data-testid="venue-booking-url-input"
                  autoComplete="url"
                />
              </div>

              <div className="rounded-xl border border-border bg-secondary/50 p-4 text-sm leading-relaxed text-muted-foreground">
                Designed for wedding and event venues: true-to-space visuals,
                branded gallery delivery, and compact marketing variants for email,
                ads, and embeds.
              </div>

              <Button
                type="submit"
                variant="rose"
                disabled={isSubmitting}
                className="w-full h-12 font-medium mt-4 transition-all"
                data-testid="create-venue-submit"
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Enter dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>
            
            <div className="mt-8 text-center">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setLocation("/login")}
                className="text-muted-foreground hover:text-foreground"
                data-testid="venue-existing-login"
              >
                Already have an account? Sign in
              </Button>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

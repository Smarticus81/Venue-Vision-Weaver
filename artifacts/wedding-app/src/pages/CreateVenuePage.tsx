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
    <div className="min-h-screen bg-white text-[#111111] font-sans selection:bg-gold selection:text-white flex flex-col">
      <header className="absolute top-0 w-full p-6 sm:p-10 flex items-center justify-between z-10">
        <GlimpseLogo href="/" />
        <Button variant="ghost" onClick={() => setLocation("/")} className="text-sm font-medium text-gray-500 hover:text-[#111111]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to site
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 relative py-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(194,163,107,0.05),transparent_50%)] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md mt-10"
        >
          <div className="bg-white rounded-3xl border border-gray-100 p-8 sm:p-10 shadow-xl shadow-black/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gold/20" />
            
            <div className="mb-8">
              <div className="w-12 h-12 rounded-2xl bg-[#fdfbf7] flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f5eedf]">
                <Building2 className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-[#111111]">Create venue</h1>
              <p className="mt-2 text-gray-500 font-light">
                Set up the owner login and dashboard
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="venue-name" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Venue name</Label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="venue-name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                    placeholder="The Willow House"
                    data-testid="venue-name-input"
                    autoComplete="organization"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-email" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Owner email</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="owner-email"
                    type="email"
                    required
                    value={formData.ownerEmail}
                    onChange={(e) => setFormData((prev) => ({ ...prev, ownerEmail: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                    placeholder="owner@venue.com"
                    data-testid="venue-owner-email-input"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="owner-password" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Password</Label>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    id="owner-password"
                    type="password"
                    required
                    minLength={8}
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    className="h-12 pl-11 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                    placeholder="At least 8 characters"
                    data-testid="venue-password-input"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="booking-url" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Tour booking link <span className="text-gray-400 font-normal normal-case">(optional)</span></Label>
                <Input
                  id="booking-url"
                  value={formData.bookingUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bookingUrl: e.target.value }))}
                  className="h-12 rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-gold"
                  placeholder="https://yourvenue.com/tours"
                  data-testid="venue-booking-url-input"
                  autoComplete="url"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 bg-black hover:bg-gray-800 text-white rounded-full font-medium mt-4 transition-all shadow-md"
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
                className="text-gray-500 hover:text-[#111111]"
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

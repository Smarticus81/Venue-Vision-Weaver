import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Camera, Check, Images, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { toVenueSlug } from "@/lib/venueSlug";

const STEPS = [
  {
    icon: <Camera className="h-6 w-6" />,
    title: "Upload portraits",
    desc: "Add up to three photos. We preserve your exact likeness.",
  },
  {
    icon: <Check className="h-6 w-6" />,
    title: "Choose a style",
    desc: "Pick the editorial look that feels closest to your celebration.",
  },
  {
    icon: <Images className="h-6 w-6" />,
    title: "Open your gallery",
    desc: "Receive four venue-anchored portraits plus a branded motion reel.",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [venueCode, setVenueCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = toVenueSlug(venueCode);
    if (slug) setLocation(`/preview/${slug}`);
  };

  const slugReady = Boolean(toVenueSlug(venueCode));

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="sticky top-0 z-50 w-full bg-background/85 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <GlimpseLogo href="/couple" />
          <Button
            variant="ghost"
            onClick={() => setLocation("/find-my-gallery")}
            className="px-5 text-sm font-medium text-muted-foreground hover:text-foreground"
            data-testid="couple-header-find-gallery"
          >
            <Images className="mr-2 h-4 w-4" /> Find my gallery
          </Button>
        </div>
      </header>

      {/* Hero paints statically — nothing above the fold waits on JS. */}
      <section className="grain relative flex-1 px-4 pt-16 pb-24 md:pt-24 md:pb-32 flex flex-col items-center justify-center overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(ellipse_at_top,hsl(var(--rose)/0.1),transparent_65%)]"
        />
        <div className="w-full max-w-2xl mx-auto text-center relative z-10">
          <h1 className="font-display text-[2.75rem] md:text-[4rem] leading-[1.04] tracking-tight font-medium text-foreground mb-6">
            See yourselves at the venue{" "}
            <em className="text-rose block mt-2">before the day arrives.</em>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground font-light leading-relaxed mb-12 max-w-xl mx-auto">
            Enter the code from your venue tour or invitation. glimpse places you in
            your real wedding space to create a private vision gallery.
          </p>

          <div className="max-w-md mx-auto">
            <div className="glimpse-card p-8 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]">
              <p className="text-xs font-semibold tracking-widest uppercase text-rose mb-5 text-center">
                Your venue code
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="e.g. oak-ridge-estate"
                    value={venueCode}
                    onChange={(e) => setVenueCode(e.target.value)}
                    className="h-14 pl-12 rounded-lg bg-background border-input text-base focus-visible:ring-ring"
                    data-testid="couple-venue-code"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button
                  type="submit"
                  variant="rose"
                  disabled={!slugReady}
                  className="h-14 rounded-lg font-medium text-base w-full"
                  data-testid="couple-venue-go"
                >
                  Continue <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-5 text-center font-light leading-relaxed">
                The code is on your venue's QR card or welcome email.
              </p>
            </div>
          </div>

          <div className="mt-8">
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground font-medium"
              onClick={() => setLocation("/find-my-gallery")}
              data-testid="couple-find-gallery-home"
            >
              Already created a gallery? Find it with your email
            </Button>
          </div>
        </div>
      </section>

      <section className="py-24 bg-card border-t border-card-border">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl text-foreground mb-4">
              Your glimpse in three steps
            </h2>
            <div className="w-12 h-px bg-rose mx-auto"></div>
          </div>

          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {STEPS.map((step) => (
              <div key={step.title} className="text-center animate-fade-in-up">
                <div className="w-14 h-14 rounded-xl bg-background flex items-center justify-center mb-6 text-rose border border-border mx-auto">
                  {step.icon}
                </div>
                <h3 className="font-sans font-bold text-lg mb-3 text-foreground">{step.title}</h3>
                <p className="text-muted-foreground font-light leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-background py-12 border-t border-border mt-auto">
        <div className="container mx-auto px-6 flex justify-center">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            A glimpse of your day
          </p>
        </div>
      </footer>
    </div>
  );
}

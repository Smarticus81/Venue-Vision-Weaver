import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Camera, Check, Images, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CoupleSiteHeader } from "@/components/layout/CoupleSiteHeader";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { toVenueSlug } from "@/lib/venueSlug";

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
    <div className="min-h-screen bg-background flex flex-col">
      <CoupleSiteHeader />

      <section className="flex-1 px-4 pt-10 pb-16">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-8 sm:hidden"
          >
            <GlimpseLogo href="/couple" className="h-20 mx-auto" />
          </motion.div>

          <motion.h1
            className="serif text-4xl md:text-5xl text-foreground mb-4 tracking-tight font-medium"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            See yourselves at the venue
            <span className="block text-primary mt-2 text-2xl md:text-3xl italic font-normal">
              before the day arrives
            </span>
          </motion.h1>

          <motion.p
            className="text-muted-foreground font-light leading-relaxed mb-10 max-w-lg mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Enter the code from your venue tour or invitation. glimpse places you in your
            real wedding space, preserves your likeness, then creates a private vision
            gallery and branded motion reel.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <Card className="border-border/80 shadow-lg bg-card/80 backdrop-blur-sm text-left">
              <CardContent className="pt-8 pb-8 px-6 sm:px-8">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4 text-center">
                  Your venue code
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="e.g. oak-ridge-estate"
                      value={venueCode}
                      onChange={(e) => setVenueCode(e.target.value)}
                      className="h-12 pl-11 bg-background border-border text-base"
                      data-testid="couple-venue-code"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!slugReady}
                    className="h-12 rounded-full px-8 bg-primary text-primary-foreground shrink-0"
                    data-testid="couple-venue-go"
                  >
                    Continue <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
                <p className="text-[11px] text-muted-foreground mt-4 text-center">
                  The code is on your venue&apos;s QR card or welcome email - usually a
                  short name like <span className="font-mono text-foreground/80">willow-creek</span>.
                </p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            className="mt-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Button
              variant="link"
              className="text-muted-foreground"
              onClick={() => setLocation("/find-my-gallery")}
              data-testid="couple-find-gallery-home"
            >
              Already created a gallery? Find it with your email
            </Button>
          </motion.div>
        </div>
      </section>

      <section className="py-16 px-4 border-t border-border/40 bg-muted/20">
        <div className="max-w-4xl mx-auto">
          <h2 className="serif text-2xl md:text-3xl text-center mb-10">Your glimpse in three steps</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                icon: <Camera className="h-7 w-7 text-primary" />,
                title: "Upload portraits",
                desc: "Add up to three photos. We preserve your exact likeness.",
              },
              {
                icon: <Check className="h-7 w-7 text-primary" />,
                title: "Choose a style",
                desc: "Pick the editorial look that feels closest to your celebration.",
              },
              {
                icon: <Images className="h-7 w-7 text-primary" />,
                title: "Open your gallery",
                desc: "Receive four venue-anchored portraits plus a branded motion reel.",
              },
            ].map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full border-border/60 bg-card/60">
                  <CardContent className="pt-6 text-center">
                    <div className="inline-flex p-3 rounded-full bg-primary/10 mb-4">
                      {step.icon}
                    </div>
                    <h3 className="serif text-lg mb-2">{step.title}</h3>
                    <p className="text-sm text-muted-foreground font-light">{step.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-10 px-4 border-t border-border/60 mt-auto">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-3 text-center">
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground">
            A glimpse of your day
          </p>
        </div>
      </footer>
    </div>
  );
}


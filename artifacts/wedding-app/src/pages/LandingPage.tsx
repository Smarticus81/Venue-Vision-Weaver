import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Camera, Check, Images, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="min-h-screen bg-white text-[#111111] font-sans selection:bg-gold selection:text-white flex flex-col">
      <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <GlimpseLogo href="/couple" />
          <div className="flex items-center">
            <Button
              variant="ghost"
              onClick={() => setLocation("/find-my-gallery")}
              className="rounded-full px-5 text-sm font-medium text-gray-600 hover:text-[#111111] hover:bg-gray-50"
              data-testid="couple-header-find-gallery"
            >
              <Images className="mr-2 h-4 w-4" /> Find my gallery
            </Button>
          </div>
        </div>
      </header>

      <section className="flex-1 px-4 pt-16 pb-24 md:pt-24 md:pb-32 flex flex-col items-center justify-center">
        <div className="w-full max-w-2xl mx-auto text-center relative z-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(194,163,107,0.08),transparent_70%)] pointer-events-none -z-10 -mt-20" />
          
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-8 sm:hidden"
          >
            <GlimpseLogo href="/couple" className="mx-auto" />
          </motion.div>

          <motion.h1
            className="font-playfair text-[2.75rem] md:text-[4rem] leading-[1.05] tracking-tight font-normal text-[#111111] mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            See yourselves at the venue <span className="text-gold italic block mt-2">before the day arrives.</span>
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-gray-500 font-light leading-relaxed mb-12 max-w-xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.8 }}
          >
            Enter the code from your venue tour or invitation. Glimpse places you in your
            real wedding space to create a private vision gallery.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-md mx-auto"
          >
            <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-xl shadow-black/5">
              <p className="text-xs font-semibold tracking-widest uppercase text-gold mb-5 text-center">
                Your venue code
              </p>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    placeholder="e.g. oak-ridge-estate"
                    value={venueCode}
                    onChange={(e) => setVenueCode(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-gray-50/50 border-gray-200 text-base focus-visible:ring-gold"
                    data-testid="couple-venue-code"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!slugReady}
                  className="h-14 rounded-full bg-black hover:bg-gray-800 text-white font-medium text-base shadow-md w-full"
                  data-testid="couple-venue-go"
                >
                  Continue <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </form>
              <p className="text-xs text-gray-400 mt-5 text-center font-light leading-relaxed">
                The code is on your venue's QR card or welcome email.
              </p>
            </div>
          </motion.div>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Button
              variant="ghost"
              className="text-gray-500 hover:text-[#111111] font-medium"
              onClick={() => setLocation("/find-my-gallery")}
              data-testid="couple-find-gallery-home"
            >
              Already created a gallery? Find it with your email
            </Button>
          </motion.div>
        </div>
      </section>

      <section className="py-24 bg-[#fdfbf7] border-t border-[#f5eedf]">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="font-playfair text-3xl md:text-4xl text-[#111111] mb-4">Your glimpse in three steps</h2>
            <div className="w-12 h-px bg-gold mx-auto"></div>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            {[
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
            ].map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.6 }}
                className="text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center mb-6 text-gold shadow-sm border border-[#f0e6d2] mx-auto">
                  {step.icon}
                </div>
                <h3 className="font-bold text-lg mb-3 text-[#111111]">{step.title}</h3>
                <p className="text-gray-500 font-light leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-white py-12 border-t border-gray-100 mt-auto">
        <div className="container mx-auto px-6 flex justify-center">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-gray-400">
            A glimpse of your day
          </p>
        </div>
      </footer>
    </div>
  );
}

import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ImageUp,
  LockKeyhole,
  Mail,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const HERO_IMAGE = "/brand/venue-landing-hero.png";

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen overflow-hidden bg-[#f7faff] text-[#111318]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#f8fbff_0%,#f6eef5_42%,#edf8f5_100%)]" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.92),transparent_26%),radial-gradient(circle_at_82%_18%,rgba(203,235,255,0.72),transparent_29%),radial-gradient(circle_at_52%_86%,rgba(255,230,238,0.7),transparent_31%)]" />

      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/48 backdrop-blur-3xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="flex items-center gap-2"
            aria-label="Glimpse home"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111318] text-white shadow-lg">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-lg font-semibold tracking-normal">glimpse</span>
          </button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setLocation("/login")}
              className="text-foreground/68 hover:text-foreground"
              data-testid="venue-header-sign-in"
            >
              <LockKeyhole className="mr-2 h-4 w-4" />
              Login
            </Button>
            <Button
              onClick={() => setLocation("/create-venue")}
              className="bg-[#111318] text-white hover:bg-[#252932]"
              data-testid="venue-header-register"
            >
              Start <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[0.92fr_1.08fr]">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl"
          >
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/48 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Tour conversion system
            </div>
            <h1 className="text-5xl font-semibold leading-[0.96] tracking-normal sm:text-6xl lg:text-7xl">
              The follow-up couples remember.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-foreground/62">
              Glimpse gives venues a private dashboard for turning tour photos
              into cinematic, email-delivered wedding galleries at the actual property.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                onClick={() => setLocation("/create-venue")}
                className="h-12 bg-[#111318] px-7 text-white hover:bg-[#252932]"
                data-testid="venue-hero-register"
              >
                Create venue workspace <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setLocation("/login")}
                className="h-12 border-white/75 bg-white/45 px-7 backdrop-blur-xl"
                data-testid="owner-cta"
              >
                <LockKeyhole className="mr-2 h-4 w-4" />
                Login
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65, delay: 0.1 }}
            className="relative"
          >
            <div className="overflow-hidden rounded-lg border border-white/70 bg-white/50 p-3 shadow-[0_35px_110px_rgba(31,41,55,0.18),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-3xl">
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg">
                <img
                  src={HERO_IMAGE}
                  alt="Wedding venue ceremony space"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,19,24,0.05),rgba(17,19,24,0.58))]" />
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                  <div className="rounded-lg border border-white/30 bg-white/18 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-2xl">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/68">
                      Ready gallery
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      {["4 stills", "1 reel", "1 email"].map((item) => (
                        <div key={item} className="rounded-md bg-white/18 px-3 py-3 text-center text-sm font-medium">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                icon: <ImageUp className="h-5 w-5" />,
                title: "Venue uploads spaces",
                text: "One polished profile powers every gallery.",
              },
              {
                icon: <Mail className="h-5 w-5" />,
                title: "Bride receives email",
                text: "The private gallery link is delivered when it is ready.",
              },
              {
                icon: <CalendarCheck className="h-5 w-5" />,
                title: "Tour CTA stays close",
                text: "Every gallery points attention back to booking the visit.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-white/70 bg-white/52 p-5 shadow-[0_18px_55px_rgba(31,41,55,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-2xl"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#111318] text-white">
                  {item.icon}
                </div>
                <h2 className="text-lg font-semibold tracking-normal">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-foreground/58">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-white/70 bg-white/40 px-4 py-14 backdrop-blur-3xl sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-foreground/48">
                Minimal workflow
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-normal">No portal maze.</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                "Login with owner credentials",
                "Keep venue photos ready",
                "Email finished galleries",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-lg bg-white/55 p-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-white">
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium leading-5">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

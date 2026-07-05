import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";

const HERO_IMAGE = "/brand/venue-landing-hero.webp";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type Step = {
  index: string;
  title: string;
  text: string;
};

const MECHANISM_STEPS: Step[] = [
  {
    index: "01",
    title: "The tour ends",
    text: "You hand the couple a card with your QR code, or drop your glimpse link into the thank-you email. That's the whole lift on your side.",
  },
  {
    index: "02",
    title: "They add three photos",
    text: "The couple opens your branded page, uploads portraits of themselves, and picks the style closest to their day.",
  },
  {
    index: "03",
    title: "glimpse builds their gallery",
    text: "Four photoreal portraits of them in your actual rooms — likeness preserved and quality-reviewed — plus a motion reel carrying your brand.",
  },
  {
    index: "04",
    title: "You stay in the conversation",
    text: "The gallery lands while they're still deciding, on a share page with your venue's name and the booking step in view.",
  },
];

const PROOF_POINTS = [
  {
    title: "Likeness comes first",
    text: "Galleries are generated from the couple's own portraits and reviewed for accuracy before delivery. A render that misses the bar isn't sent — the credit is refunded.",
  },
  {
    title: "You approve the send",
    text: "Preview every gallery before it goes out, so follow-up stays polished, accurate, and yours.",
  },
  {
    title: "Your brand on every frame",
    text: "The motion reel and the share page carry your venue's name — couples pass it to parents and friends, and your booking step travels with it.",
  },
];

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();

  // overflow-x must be clip, not hidden: hidden creates a scroll container
  // and silently breaks every position:sticky descendant (header + scrub).
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground font-sans">
      <header className="sticky top-0 z-50 w-full bg-background/85 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-6 h-18 md:h-20 flex items-center justify-between">
          <GlimpseLogo href="/" />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setLocation("/login")}
              className="px-4 md:px-5 text-sm font-medium text-muted-foreground hover:text-foreground"
              data-testid="venue-header-sign-in"
            >
              Sign in
            </Button>
            <Button
              variant="rose"
              onClick={() => setLocation("/create-venue")}
              data-testid="venue-header-register"
            >
              Start free
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero — paints statically; nothing above the fold waits on JS. */}
        <section className="grain relative pt-16 pb-20 md:pt-24 md:pb-28 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(ellipse_at_top,hsl(var(--rose)/0.09),transparent_65%)]"
          />
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-10 items-center">
              <div className="max-w-xl">
                <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold tracking-[0.14em] uppercase text-rose">
                  For wedding venues
                </p>
                <h1 className="font-display text-[2.9rem] md:text-[4.1rem] leading-[1.02] tracking-tight font-medium text-foreground mb-6">
                  Turn venue tours into{" "}
                  <em className="text-rose">bookings.</em>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground mb-9 max-w-lg leading-relaxed font-light">
                  After the tour, glimpse sends each couple a private gallery of
                  themselves in your actual rooms — four photoreal portraits and a
                  branded motion reel — while they're still deciding.
                </p>
                <div className="flex flex-col items-start gap-4">
                  <Button
                    size="lg"
                    variant="rose"
                    onClick={() => setLocation("/create-venue")}
                    className="group w-full sm:w-auto px-8 py-6 text-base shadow-[0_8px_40px_-8px_hsl(var(--rose)/0.5)]"
                    data-testid="venue-hero-register"
                  >
                    Start with 5 free galleries
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-200 ease-out group-hover:translate-x-1" />
                  </Button>
                  <p className="text-sm text-muted-foreground font-light">
                    No card. No contract. One credit is one couple's complete gallery.
                  </p>
                  <button
                    type="button"
                    onClick={() => setLocation("/login")}
                    className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                    data-testid="owner-cta"
                  >
                    Already set up? Sign in
                  </button>
                </div>
              </div>

              <div className="relative">
                <div className="relative rounded-xl overflow-hidden border border-card-border shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
                  <img
                    src={HERO_IMAGE}
                    alt="A venue dashboard on a tablet inside a bright ceremony room, showing a couple's four-image gallery and QR code"
                    width={1240}
                    height={698}
                    fetchPriority="high"
                    decoding="async"
                    className="h-auto w-full object-cover"
                  />
                </div>
                <p className="mt-4 text-center text-xs font-medium tracking-[0.16em] uppercase text-muted-foreground">
                  Four portraits + a motion reel, delivered with your booking link
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Problem — the felt cost of the cold follow-up. */}
        <section className="py-20 md:py-28 bg-card border-y border-card-border">
          <div className="container mx-auto px-6">
            <div className="max-w-3xl mx-auto md:ml-[14%]">
              <Reveal>
                <p className="text-xs font-semibold tracking-[0.18em] uppercase text-rose mb-5">
                  The follow-up problem
                </p>
                <h2 className="font-display text-3xl md:text-[2.75rem] leading-[1.1] text-foreground mb-7">
                  Every tour ends with "we'll think about it."
                </h2>
              </Reveal>
              <Reveal delay={0.08}>
                <div className="space-y-5 text-lg text-muted-foreground font-light leading-relaxed max-w-2xl">
                  <p>
                    Then they tour three more venues, and your thank-you email lands in
                    the same inbox as everyone else's. The couple who fell quiet in your
                    ceremony room is now comparing you on price per plate.
                  </p>
                  <p>
                    The venue that stays vivid wins the booking — and photos of empty
                    rooms don't stay vivid. Photos of{" "}
                    <em className="text-foreground font-normal">them</em> in your rooms do.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Mechanism — the signature scroll-scrubbed timeline. */}
        <MechanismSection />

        {/* Proof — what keeps the gallery credible enough to send. */}
        <section className="py-20 md:py-28 bg-card border-y border-card-border">
          <div className="container mx-auto px-6 max-w-5xl">
            <Reveal className="max-w-2xl mb-14">
              <p className="text-xs font-semibold tracking-[0.18em] uppercase text-rose mb-5">
                Why venues trust the send
              </p>
              <h2 className="font-display text-3xl md:text-[2.75rem] leading-[1.1] text-foreground">
                Their faces. Your rooms. Nothing generic.
              </h2>
            </Reveal>
            <div className="grid gap-px overflow-hidden rounded-xl border border-card-border bg-card-border md:grid-cols-3">
              {PROOF_POINTS.map((point, i) => (
                <Reveal key={point.title} delay={i * 0.07} className="bg-background p-8 md:p-9 h-full">
                  <span className="mb-6 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-rose">
                    <Check className="h-4 w-4" />
                  </span>
                  <h3 className="font-sans text-lg font-bold tracking-tight text-foreground mb-3">
                    {point.title}
                  </h3>
                  <p className="text-muted-foreground font-light leading-relaxed text-[0.95rem]">
                    {point.text}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Risk reversal — the trial, stated plainly. */}
        <section className="grain relative py-20 md:py-28 bg-background">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[24rem] bg-[radial-gradient(ellipse_at_bottom,hsl(var(--rose)/0.08),transparent_70%)]"
          />
          <div className="container relative z-10 mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center">
              <Reveal>
                <h2 className="font-display text-3xl md:text-[2.75rem] leading-[1.1] text-foreground mb-6">
                  Your first five galleries are on us.
                </h2>
                <p className="text-lg text-muted-foreground font-light leading-relaxed mb-10 max-w-2xl mx-auto">
                  Create a workspace, add your venue photos, and hand the link to the
                  next couple who tours. No card and no subscription to start. When the
                  galleries start reopening conversations, add credits — one credit is
                  one couple's complete gallery.
                </p>
                <Button
                  size="lg"
                  variant="rose"
                  onClick={() => setLocation("/create-venue")}
                  className="group px-8 py-6 text-base shadow-[0_8px_40px_-8px_hsl(var(--rose)/0.5)]"
                  data-testid="venue-trial-register"
                >
                  Create your venue workspace
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-200 ease-out group-hover:translate-x-1" />
                </Button>
              </Reveal>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-card py-12 border-t border-card-border">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <GlimpseLogo href="/" />
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="/couple" className="hover:text-foreground underline-offset-4 hover:underline">
              For couples
            </a>
            <a href="/login" className="hover:text-foreground underline-offset-4 hover:underline">
              Sign in
            </a>
          </nav>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} glimpse
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Entrance reveal: once per element, ≤20px travel, crossfade-only when the
 * visitor prefers reduced motion.
 */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
      whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [...EASE_OUT] }}
    >
      {children}
    </motion.div>
  );
}

function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setWide(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}

/**
 * Signature moment: a sticky viewport where the four post-tour beats scrub in
 * with scroll position, paced by a rose progress rail. Falls back to a static
 * list for reduced-motion visitors and viewports under 1024px.
 */
function MechanismSection() {
  const reduceMotion = useReducedMotion();
  const wide = useIsWide();

  if (reduceMotion || !wide) {
    return (
      <section className="py-20 bg-background">
        <div className="container mx-auto px-6 max-w-3xl">
          <MechanismHeading />
          <ol className="mt-12 space-y-10">
            {MECHANISM_STEPS.map((step) => (
              <li key={step.index} className="flex gap-5">
                <span className="font-display text-2xl text-rose shrink-0 leading-none pt-1">
                  {step.index}
                </span>
                <div>
                  <h3 className="font-sans text-xl font-bold tracking-tight text-foreground mb-2">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground font-light leading-relaxed">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return <ScrubbedMechanism />;
}

function MechanismHeading() {
  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.18em] uppercase text-rose mb-5">
        How it works
      </p>
      <h2 className="font-display text-3xl md:text-[2.75rem] leading-[1.1] text-foreground">
        The 48 hours after the tour.
      </h2>
    </div>
  );
}

function ScrubbedMechanism() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });
  const railScale = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section ref={trackRef} className="relative bg-background" style={{ height: "320vh" }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-[1fr_auto_1.15fr] gap-12 lg:gap-16 items-center">
            <MechanismHeading />

            <div className="relative h-72 w-px bg-border" aria-hidden>
              <motion.div
                className="absolute inset-x-0 top-0 w-px bg-rose origin-top"
                style={{ scaleY: railScale, height: "100%" }}
              />
            </div>

            <div className="relative h-64">
              {MECHANISM_STEPS.map((step, i) => (
                <StepPanel
                  key={step.index}
                  step={step}
                  index={i}
                  total={MECHANISM_STEPS.length}
                  progress={scrollYProgress}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StepPanel({
  step,
  index,
  total,
  progress,
}: {
  step: Step;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const start = index / total;
  const end = (index + 1) / total;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const opacity = useTransform(
    progress,
    [Math.max(0, start - 0.04), start + 0.05, end - 0.05, Math.min(1, end + 0.04)],
    [isFirst ? 1 : 0, 1, 1, isLast ? 1 : 0],
  );
  const y = useTransform(
    progress,
    [Math.max(0, start - 0.04), start + 0.05, end - 0.05, Math.min(1, end + 0.04)],
    [isFirst ? 0 : 28, 0, 0, isLast ? 0 : -28],
  );

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex flex-col justify-center">
      <span className="font-display text-5xl text-rose/50 leading-none mb-5">{step.index}</span>
      <h3 className="font-sans text-2xl font-bold tracking-tight text-foreground mb-3">{step.title}</h3>
      <p className="max-w-md text-lg text-muted-foreground font-light leading-relaxed">{step.text}</p>
    </motion.div>
  );
}

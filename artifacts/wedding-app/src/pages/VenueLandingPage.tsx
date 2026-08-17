import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { cn } from "@/lib/utils";
import { GALLERY_FRAMES } from "@/lib/brandAssets";
import { DescentJourney } from "./venue-landing/DescentJourney";
import { FlightBackdrop } from "./venue-landing/FlightBackdrop";
import { MoodDial } from "./venue-landing/MoodDial";
import { DEFAULT_MOOD, MOOD_THEME_COLOR, type MoodKey } from "./venue-landing/moods";

/**
 * “The venue at dusk” — the entire page floats over one continuous
 * procedural WebGL evening (sky, string lights, candle bokeh, drifting
 * petals). The signature interaction is the mood dial: visitors re-light
 * the venue in golden hour / candlelight / moonlight — which is exactly
 * what the product does for couples.
 *
 * Conversion spine: get venue owners to create a venue workspace,
 * because a vivid personalized gallery reopens the booking conversation
 * while the decision is still warm — and the first five galleries are
 * free.
 */

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();
  const [mood, setMood] = useState<MoodKey>(DEFAULT_MOOD);

  // Keep the browser chrome in the scene's light.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", MOOD_THEME_COLOR[mood]);
    return () => {
      if (prev) meta?.setAttribute("content", prev);
    };
  }, [mood]);

  const goStart = () => setLocation("/create-venue");
  const goSignIn = () => setLocation("/login");

  return (
    <div
      className="theme-dusk relative min-h-screen overflow-x-clip bg-[#070b14]"
      data-mood={mood}
    >
      {/* The flight footage is the page background — fixed, full-bleed,
          scrubbed by scroll. The flat base color above only exists for
          the instant before the poster paints. */}
      <FlightBackdrop />

      <div className="relative z-10">
        <Nav onStart={goStart} onSignIn={goSignIn} />
        <main>
          <Hero mood={mood} onMood={setMood} onStart={goStart} onSignIn={goSignIn} />
          <ProblemScene />
          <GalleryScene />
          <DescentJourney />
          <StepsScene />
          <OutcomesScene />
          <OfferScene onStart={goStart} />
        </main>
        <Footer />
      </div>
    </div>
  );
}

/* ————————————————— shared pieces ————————————————— */

function GlowButton({
  children,
  onClick,
  testId,
  size = "md",
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
  size?: "md" | "xl";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "lp-sheen group inline-flex items-center justify-center gap-2.5 rounded-full font-semibold",
        "hover:scale-[1.03] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-transparent",
        size === "xl" ? "h-16 px-10 text-lg md:h-[4.5rem] md:px-14 md:text-xl" : "h-12 px-7 text-[15px]",
        className,
      )}
      style={{
        background: "var(--lp-accent)",
        color: "var(--lp-accent-ink)",
        boxShadow: "0 10px 42px -10px color-mix(in srgb, var(--lp-accent) 60%, transparent)",
        transition:
          "transform .3s cubic-bezier(.16,1,.3,1), background-color .8s, color .8s, box-shadow .8s",
      }}
    >
      {children}
      <ArrowRight className="h-[1.05em] w-[1.05em] transition-transform duration-300 ease-out group-hover:translate-x-1" />
    </button>
  );
}

/** Once-per-element entrance: rise + settle, disabled under reduced motion. */
function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("lp-eyebrow lp-accent", className)}>{children}</p>;
}

/* ————————————————— nav ————————————————— */

function useScrolledPast(threshold = 48) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return past;
}

function Nav({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const past = useScrolledPast();
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        past
          ? "border-b border-white/10 bg-[rgba(8,6,16,0.6)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 md:h-[4.5rem] md:px-8">
        <GlimpseLogo href="/" className="text-[1.15rem]" />

        <div className="hidden items-center gap-1 lg:flex">
          {[
            { label: "How it works", href: "#how-it-works" },
            { label: "The gallery", href: "#deliverable" },
            { label: "The descent", href: "#ceremony" },
            { label: "For couples", href: "/couple" },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm text-foreground/65 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSignIn}
            data-testid="venue-header-sign-in"
            className="hidden rounded-full px-4 py-2 text-sm text-foreground/65 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
          >
            Sign in
          </button>
          <GlowButton onClick={onStart} testId="venue-header-register" className="h-10 px-5 text-sm">
            Create your venue
          </GlowButton>
        </div>
      </nav>
    </header>
  );
}

/* ————————————————— hero ————————————————— */

function Hero({
  mood,
  onMood,
  onStart,
  onSignIn,
}: {
  mood: MoodKey;
  onMood: (m: MoodKey) => void;
  onStart: () => void;
  onSignIn: () => void;
}) {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 pb-28 pt-28 text-center md:pb-32">
      <h1 className="sr-only">Turn tours into bookings</h1>

      <div aria-hidden>
        <p className="lp-rise lp-eyebrow lp-accent" style={{ "--lp-d": "0ms" } as CSSProperties}>
          For wedding venues
        </p>
        <div className="lp-display mt-6 text-[clamp(3.1rem,10vw,8.75rem)] text-foreground">
          <span className="lp-rise block" style={{ "--lp-d": "90ms" } as CSSProperties}>
            Turn tours into
          </span>
          <span className="lp-rise block italic lp-accent" style={{ "--lp-d": "210ms" } as CSSProperties}>
            bookings.
          </span>
        </div>
      </div>

      <p
        className="lp-rise mx-auto mt-8 max-w-xl text-[15px] leading-relaxed text-foreground/80 md:text-base"
        style={{ "--lp-d": "330ms" } as CSSProperties}
      >
        Couples scan your code and generate a four-image vision gallery plus a
        branded motion reel — at your venue, before they've booked it.
      </p>

      <div
        className="lp-rise mt-10 flex flex-col items-center gap-5 sm:flex-row"
        style={{ "--lp-d": "430ms" } as CSSProperties}
      >
        <GlowButton onClick={onStart} testId="venue-hero-register">
          Create your venue
        </GlowButton>
        <button
          type="button"
          onClick={onSignIn}
          data-testid="owner-cta"
          className="rounded-sm text-sm text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Already set up? Sign in
        </button>
      </div>

      <p
        className="lp-rise mt-6 text-[13px] text-foreground/50"
        style={{ "--lp-d": "520ms" } as CSSProperties}
      >
        5 free galleries to start · 1 credit = 1 couple's gallery
      </p>

      <div className="lp-rise mt-14" style={{ "--lp-d": "620ms" } as CSSProperties}>
        <MoodDial mood={mood} onMood={onMood} />
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute bottom-7 left-1/2 hidden -translate-x-1/2 md:block"
      >
        <div className="lp-scroll-cue flex flex-col items-center gap-2 text-foreground/50">
          <span className="lp-eyebrow">Scroll</span>
          <span className="h-8 w-px bg-foreground/40" />
        </div>
      </div>
    </section>
  );
}

/* ————————————————— the problem ————————————————— */

function ProblemScene() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <div className="grid gap-12 md:grid-cols-12 md:gap-8">
        <Reveal className="md:col-span-7">
          <Eyebrow>The follow-up problem</Eyebrow>
          <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
            Every tour ends with{" "}
            <em className="lp-accent">“wow — I can see it.”</em>
          </h2>
        </Reveal>
        <Reveal delay={0.12} className="self-end md:col-span-4 md:col-start-9">
          <div className="space-y-5 text-base leading-relaxed text-foreground/75 md:text-lg">
            <p>
              Then the follow-up goes home in an email that looks like every
              other venue's.
            </p>
            <p>
              The venue that stays vivid wins the date. Photos of{" "}
              <em className="font-display text-foreground">them</em> in your
              venue stay vivid.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ————————————————— the gallery ————————————————— */

const PRINT_TILTS = [
  { from: -6, to: -2, y: "md:mt-0" },
  { from: 4, to: 1.5, y: "md:mt-16" },
  { from: -4, to: -1.5, y: "md:mt-6" },
  { from: 6, to: 2, y: "md:mt-20" },
];

function GalleryPrint({
  frame,
  tilt,
  delay,
}: {
  frame: (typeof GALLERY_FRAMES)[number];
  tilt: (typeof PRINT_TILTS)[number];
  delay: number;
}) {
  const reduce = useReducedMotion();
  const inner = (
    <figure className="group">
      <div className="rounded-[4px] bg-white p-2 pb-3 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.65)] transition-shadow duration-500 group-hover:shadow-[0_34px_80px_-16px_rgba(0,0,0,0.75)]">
        <img
          src={frame.src}
          alt={frame.alt}
          loading="lazy"
          decoding="async"
          className="aspect-[4/5] w-full rounded-[2px] object-cover"
        />
      </div>
      <figcaption className="mt-4 flex items-baseline justify-between gap-3 px-1">
        <span className="text-sm font-medium text-foreground/90">{frame.label}</span>
        <span className="lp-eyebrow text-foreground/40">{frame.index}</span>
      </figcaption>
    </figure>
  );

  if (reduce) return <div className={tilt.y}>{inner}</div>;

  return (
    <motion.div
      className={tilt.y}
      initial={{ opacity: 0, y: 60, rotate: tilt.from }}
      whileInView={{ opacity: 1, y: 0, rotate: tilt.to }}
      whileHover={{ rotate: 0, y: -8 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ type: "spring", stiffness: 90, damping: 16, delay }}
    >
      {inner}
    </motion.div>
  );
}

function GalleryScene() {
  return (
    <section id="deliverable" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <Reveal className="max-w-3xl">
        <Eyebrow>The deliverable</Eyebrow>
        <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
          One tour becomes a <em className="lp-accent">daydream</em> of their
          day.
        </h2>
      </Reveal>

      <div className="mt-16 grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-7">
        {GALLERY_FRAMES.map((f, i) => (
          <GalleryPrint key={f.index} frame={f} tilt={PRINT_TILTS[i]} delay={i * 0.08} />
        ))}
      </div>

      <Reveal delay={0.1}>
        <p className="mt-12 text-[13px] text-foreground/50">
          Frames from sample glimpse galleries · every gallery ships with a
          branded motion reel
        </p>
      </Reveal>
    </section>
  );
}

/* ————————————————— how it works ————————————————— */

const STEPS = [
  {
    n: "01",
    title: "The tour ends",
    text: "Your QR card or link goes home with the couple.",
  },
  {
    n: "02",
    title: "They add three photos",
    text: "Your branded page. Their portraits. One style pick.",
  },
  {
    n: "03",
    title: "glimpse develops the gallery",
    text: "Four photoreal portraits in your venue, plus a branded motion reel.",
  },
  {
    n: "04",
    title: "The booking step arrives with it",
    text: "Delivered while they're deciding — your venue's name and booking link on the share page.",
  },
];

function StepsScene() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <Reveal className="max-w-3xl">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
          The 48 hours <em className="lp-accent">after</em> the tour.
        </h2>
      </Reveal>

      <div className="relative mt-20">
        {/* The thread the steps hang from — one more string of light. */}
        <div aria-hidden className="lp-thread absolute inset-y-0 left-[7px] w-px md:left-1/2" />

        <ol className="space-y-16 md:space-y-24">
          {STEPS.map((s, i) => {
            const left = i % 2 === 0;
            return (
              <li key={s.n} className="relative md:grid md:grid-cols-2 md:gap-16">
                <span
                  aria-hidden
                  className="absolute left-0 top-2 h-[15px] w-[15px] rounded-full md:left-1/2 md:-translate-x-1/2"
                  style={{
                    background: "var(--lp-accent)",
                    boxShadow: "0 0 18px 2px color-mix(in srgb, var(--lp-accent) 70%, transparent)",
                  }}
                />
                <Reveal
                  className={cn(
                    "pl-10 md:pl-0",
                    left ? "md:pr-4 md:text-right" : "md:col-start-2 md:pl-4",
                  )}
                >
                  <span className="lp-display italic lp-accent text-4xl md:text-5xl">{s.n}</span>
                  <h3 className="mt-3 text-xl font-bold tracking-tight text-foreground md:text-2xl">
                    {s.title}
                  </h3>
                  <p
                    className={cn(
                      "mt-3 max-w-md leading-relaxed text-foreground/70",
                      left && "md:ml-auto",
                    )}
                  >
                    {s.text}
                  </p>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ————————————————— outcomes ————————————————— */

const OUTCOMES = [
  {
    title: "More toured couples book",
    text: "Personal, vivid follow-up lands while the decision is still open — not another thank-you email.",
    span: "md:col-span-7",
  },
  {
    title: "Marketing assets, made for you",
    text: "Every gallery ships as a branded share page and motion reel — ready for your follow-up emails, ads, and socials.",
    span: "md:col-span-5 md:mt-12",
  },
  {
    title: "Your brand does the traveling",
    text: "Couples pass the gallery to parents and friends. Your venue's name and booking step travel with every share.",
    span: "md:col-span-8 md:col-start-4 md:-mt-4",
  },
];

function OutcomesScene() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <Reveal className="max-w-3xl">
        <Eyebrow>What it does for the business</Eyebrow>
        <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
          Follow-up that <em className="lp-accent">sells the date.</em>
        </h2>
      </Reveal>

      <div className="mt-16 grid gap-6 md:grid-cols-12">
        {OUTCOMES.map((o, i) => (
          <Reveal key={o.title} delay={i * 0.08} className={o.span}>
            <div className="lp-panel h-full p-8 transition-transform duration-500 hover:-translate-y-1 md:p-10">
              <h3 className="lp-display text-2xl text-foreground md:text-3xl">{o.title}</h3>
              <p className="mt-4 max-w-xl leading-relaxed text-foreground/70">{o.text}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1}>
        <p className="mt-10 text-[13px] text-foreground/50">
          Likeness reviewed before every send · you approve every gallery ·
          failed renders refund the credit
        </p>
      </Reveal>
    </section>
  );
}

/* ————————————————— the offer ————————————————— */

function OfferScene({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative px-5 py-32 text-center md:py-48">
      <Reveal>
        <Eyebrow>The offer</Eyebrow>
        <h2 className="lp-display mt-8 text-[clamp(2.8rem,9vw,8rem)] text-foreground">
          One link.
          <br />
          <em className="lp-accent">Every tour.</em>
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-foreground/75 md:text-lg">
          Hand the link to the next couple who tours. Add credits when the
          bookings follow.
        </p>
        <div className="mt-12">
          <GlowButton onClick={onStart} size="xl" testId="venue-trial-register">
            Create your venue workspace
          </GlowButton>
        </div>
        <p className="mt-6 text-[13px] text-foreground/50">
          No card required · 5 free galleries
        </p>
      </Reveal>
    </section>
  );
}

/* ————————————————— footer ————————————————— */

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[rgba(6,4,12,0.55)] backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex flex-col gap-3">
          <GlimpseLogo href="/" className="text-[1.15rem]" />
          <p className="text-sm text-foreground/55">
            A glimpse of their day — in your venue.
          </p>
        </div>
        <nav className="flex items-center gap-8">
          <a
            href="/couple"
            className="text-sm text-foreground/65 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            For couples
          </a>
          <a
            href="/login"
            className="text-sm text-foreground/65 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            Sign in
          </a>
        </nav>
        <p className="text-sm text-foreground/45">
          © {new Date().getFullYear()} glimpse
        </p>
      </div>
    </footer>
  );
}

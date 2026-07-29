import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import {
  DarkroomCursor,
  FrameTicks,
  Magnetic,
  Marquee,
} from "@/components/motion";
import { cn } from "@/lib/utils";
import { BRAND_ASSETS, GALLERY_FRAMES } from "@/lib/brandAssets";

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

/** The signature CTA: a ticked viewfinder rectangle that fills rose. */
function TickButton({
  children,
  onClick,
  className,
  testId,
  size = "md",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
  testId?: string;
  size?: "md" | "xl";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-cursor="focus"
      className={cn(
        "group relative inline-flex items-center justify-center gap-3 bg-rose text-rose-foreground font-medium transition-colors duration-200 hover:bg-rose-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        size === "xl" ? "h-16 md:h-20 px-10 md:px-16 text-lg md:text-xl" : "h-13 px-8 text-base",
        className,
      )}
    >
      <FrameTicks className="opacity-0 transition-opacity duration-200 group-hover:opacity-100 -m-2" size={12} />
      {children}
      <ArrowRight className="h-[1.1em] w-[1.1em] transition-transform duration-200 ease-out group-hover:translate-x-1.5" />
    </button>
  );
}

function SceneLabel({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-center gap-4 border-t border-border pt-4">
      <span className="mono-label text-rose">{index}</span>
      <span className="mono-label text-muted-foreground">{title}</span>
    </div>
  );
}

export default function VenueLandingPage() {
  const [, setLocation] = useLocation();
  const { scrollYProgress } = useScroll();
  const pageProgress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  // overflow-x must be clip, not hidden: hidden creates a scroll container
  // and silently breaks every position:sticky descendant.
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground font-sans">
      <DarkroomCursor />

      {/* Reading progress hairline */}
      <motion.div
        aria-hidden
        className="fixed inset-x-0 top-0 z-[60] h-px origin-left bg-rose"
        style={{ scaleX: pageProgress }}
      />

      <PillNav
        onStart={() => setLocation("/create-venue")}
        onSignIn={() => setLocation("/login")}
      />

      <main>
        <HeroScene onStart={() => setLocation("/create-venue")} onSignIn={() => setLocation("/login")} />
        <MarqueeBand />
        <ProblemScene />
        <div id="deliverable">
          <DevelopingPrintScene />
        </div>
        <div id="how-it-works">
          <MechanismScene />
        </div>
        <GuardrailScene />
        <OfferScene onStart={() => setLocation("/create-venue")} />
      </main>

      <Footer onStart={() => setLocation("/create-venue")} />
    </div>
  );
}

/* ————————————————— Pill navigation ————————————————— */

function useScrolledPast(threshold = 40) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return past;
}

function PillNav({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const past = useScrolledPast();
  return (
    <div className="fixed inset-x-0 top-0 z-50 px-4 pt-4 md:px-8 md:pt-5">
      <nav className="mx-auto flex max-w-[110rem] items-center justify-between gap-3">
        <div
          className={cn(
            "flex items-center rounded-full border border-white/10 px-4 py-2.5 backdrop-blur-xl transition-colors duration-300",
            past ? "bg-background/85" : "bg-background/55",
          )}
        >
          <GlimpseLogo href="/" className="text-[1.2rem]" />
        </div>

        <div
          className={cn(
            "hidden items-center rounded-full border border-white/10 px-2 py-1.5 backdrop-blur-xl transition-colors duration-300 lg:flex",
            past ? "bg-background/85" : "bg-background/55",
          )}
        >
          {[
            { label: "How it works", href: "#how-it-works" },
            { label: "The deliverable", href: "#deliverable" },
            { label: "For couples", href: "/couple" },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {l.label}
            </a>
          ))}
          <button
            type="button"
            onClick={onSignIn}
            data-testid="venue-header-sign-in"
            className="rounded-full px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </button>
        </div>

        <button
          type="button"
          onClick={onStart}
          data-testid="venue-header-register"
          data-cursor="focus"
          className="rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors duration-200 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Create your venue
        </button>
      </nav>
    </div>
  );
}

/* ————————————————— 001 · Video hero ————————————————— */

const HERO_STATS = [
  { pos: "s-tr", value: "4+1", label: "portraits + a branded reel", rule: "up" as const },
  { pos: "s-br", value: "5", label: "free credits to start", rule: "down" as const },
];

function HeroScene({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const reduce = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const videoScale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);
  const fgY = useTransform(scrollYProgress, [0, 1], ["0%", "-16%"]);
  const fgOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section
      ref={heroRef}
      id="hero"
      className="relative h-[100svh] min-h-[38rem] w-full overflow-hidden bg-background"
    >
      <motion.video
        className="absolute inset-0 h-full w-full object-cover [transform-origin:50%_45%]"
        style={reduce ? undefined : { scale: videoScale }}
        autoPlay
        loop
        muted
        playsInline
        poster={BRAND_ASSETS.heroAtmosphere}
        aria-hidden
        src="/brand/hero.mp4"
      />

      {/* Scrims: left for text legibility, bottom for the seam into the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, hsl(var(--background)/0.82) 0%, hsl(var(--background)/0.42) 42%, hsl(var(--background)/0) 72%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64"
        style={{ background: "linear-gradient(to bottom, transparent, hsl(var(--background)))" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_78%_18%,hsl(var(--rose)/0.14),transparent_70%)]"
      />

      <motion.div
        className="relative z-10 h-full w-full"
        style={reduce ? undefined : { y: fgY, opacity: fgOpacity }}
      >
        {/* Accessible heading (the visual lines below are decorative). */}
        <h1 className="sr-only">Turn tours into bookings</h1>

        {/* Mobile: clean stacked lockup. */}
        <div className="flex h-full flex-col justify-center px-6 md:hidden">
          <p className="mono-label mb-6 text-rose">For wedding venues</p>
          <div aria-hidden className="display-editorial text-[19vw] text-foreground">
            <span className="drape block" style={{ "--drape-delay": "80ms" } as CSSProperties}>
              <span>turn tours</span>
            </span>
            <span className="drape block" style={{ "--drape-delay": "200ms" } as CSSProperties}>
              <span>into</span>
            </span>
            <span className="drape block" style={{ "--drape-delay": "320ms" } as CSSProperties}>
              <span className="text-rose">bookings.</span>
            </span>
          </div>
          <p className="mt-7 max-w-sm text-[15px] leading-relaxed text-foreground/85">
            Couples scan your code and generate a four-image vision gallery plus
            a branded motion reel — at your venue, before they've booked it.
          </p>
          <div className="mt-8">
            <TickButton onClick={onStart} testId="venue-hero-register">
              Create your venue
            </TickButton>
            <button
              type="button"
              onClick={onSignIn}
              data-testid="owner-cta"
              className="mt-4 block text-sm text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Already set up? Sign in
            </button>
          </div>
        </div>

        {/* Desktop/tablet: editorial stacked lockup, indented lines + right-rail facts. */}
        <div
          aria-hidden
          className="hidden h-full flex-col justify-center px-8 md:flex lg:px-14"
        >
          <p className="mono-label mb-6 text-rose">For wedding venues</p>
          <div className="display-editorial max-w-[62vw] text-foreground text-[clamp(3.5rem,8.8vw,9.5rem)]">
            <span className="drape block" style={{ "--drape-delay": "80ms" } as CSSProperties}>
              <span>turn tours</span>
            </span>
            <span
              className="drape block ml-[16%]"
              style={{ "--drape-delay": "220ms" } as CSSProperties}
            >
              <span>into</span>
            </span>
            <span
              className="drape block ml-[5%]"
              style={{ "--drape-delay": "360ms" } as CSSProperties}
            >
              <span className="text-rose">bookings.</span>
            </span>
          </div>

          <div className="mt-10 flex max-w-xl flex-col gap-6">
            <p className="max-w-md text-[15px] leading-relaxed text-foreground/85">
              Couples scan your code and generate a four-image vision gallery
              plus a branded motion reel — at your venue, before they've booked
              it.
            </p>
            <div className="flex items-center gap-6">
              <TickButton onClick={onStart} testId="venue-hero-register">
                Create your venue
              </TickButton>
              <button
                type="button"
                onClick={onSignIn}
                data-testid="owner-cta"
                className="text-sm text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                Sign in
              </button>
            </div>
            <p className="mono-label text-foreground/50">
              1 credit = 1 couple's gallery
            </p>
          </div>
        </div>

        {HERO_STATS.map((s) => (
          <HeroStat key={s.pos} {...s} />
        ))}
      </motion.div>
    </section>
  );
}

function HeroStat({
  pos,
  value,
  label,
  rule,
}: {
  pos: string;
  value: string;
  label: string;
  rule: "up" | "down";
}) {
  const place =
    pos === "s-tr"
      ? "right-8 top-[13%] text-right lg:right-24"
      : pos === "s-bl"
        ? "left-8 bottom-[9%] lg:left-20"
        : "right-8 bottom-[6%] text-right lg:right-20";
  const alignRight = pos !== "s-bl";
  return (
    <div className={cn("absolute hidden lg:block", place)}>
      <div className={cn("flex items-center gap-4", alignRight && "justify-end")}>
        {alignRight && <span className={cn("h-px w-24 bg-rose/70", rule === "up" ? "rotate-[20deg]" : "-rotate-[20deg]")} />}
        <span className="mono-figure text-5xl font-medium text-foreground">{value}</span>
        {!alignRight && <span className={cn("h-px w-24 bg-rose/70", rule === "up" ? "rotate-[20deg]" : "-rotate-[20deg]")} />}
      </div>
      <p className="mono-label mt-3 text-foreground/60">{label}</p>
    </div>
  );
}

/* ————————————————— Marquee bridge ————————————————— */

function MarqueeBand() {
  return (
    <Marquee className="border-y border-border bg-background py-5 md:py-7" speed={32}>
      {["more bookings", "faster yeses", "follow-up that sells", "four portraits + a reel"].map((t) => (
        <span
          key={t}
          className="mx-8 inline-flex items-baseline gap-16 font-display italic font-light text-[clamp(1.5rem,3.2vw,3rem)] leading-none text-foreground/90"
        >
          {t}
          <span aria-hidden className="inline-block h-[0.42em] w-[0.42em] translate-y-[-0.05em] rounded-full bg-rose/70" />
        </span>
      ))}
    </Marquee>
  );
}

/* ————————————————— 002 · The problem ————————————————— */

function ProblemScene() {
  return (
    <section className="relative overflow-hidden bg-wine">
      <span
        aria-hidden
        className="text-stroke pointer-events-none absolute -right-6 top-2 select-none font-display text-[clamp(10rem,32vw,30rem)] leading-none"
      >
        02
      </span>
      <div className="relative z-10 px-5 py-24 md:px-10 md:py-36">
        <SceneLabel index="002" title="The follow-up problem" />
        <div className="mt-14 grid gap-12 md:grid-cols-[1.2fr_1fr] md:gap-20">
          <h2 className="font-display text-[clamp(2.2rem,5vw,4.6rem)] leading-[1.05] font-normal tracking-[-0.03em]">
            Every tour ends with{" "}
            <em className="text-rose">"wow, I can see it"</em>
          </h2>
          <div className="space-y-6 self-end text-lg font-light leading-relaxed text-muted-foreground max-w-md">
            <p>
              Then a few days later, you send them a couple more visuals and a booking link.
            </p>
            <p>
              The venue that stays vivid wins the date. Photos of{" "}
              <em className="font-display text-foreground">them</em> in your
              venue stay vivid.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ————————————————— 003 · The contact sheet ————————————————— */

function ContactFrame({ frame }: { frame: (typeof GALLERY_FRAMES)[number] }) {
  return (
    <figure className="relative">
      <div className="relative aspect-[4/5] overflow-hidden bg-card">
        <img
          src={frame.src}
          alt={frame.alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <FrameTicks size={14} className="text-foreground/60" />
      </div>
      <figcaption className="mt-3 flex items-baseline gap-3">
        <span className="mono-label text-rose">{frame.index}</span>
        <span className="text-xs text-muted-foreground">{frame.label}</span>
      </figcaption>
    </figure>
  );
}

function DevelopingPrintScene() {
  const reduce = useReducedMotion();
  const wide = useIsWide();

  if (reduce || !wide) {
    return (
      <section className="px-5 py-24 md:px-10">
        <SceneLabel index="003" title="The deliverable" />
        <h2 className="mt-10 mb-12 font-display text-[clamp(2rem,4.5vw,4rem)] leading-[1.05] font-normal tracking-[-0.03em] max-w-3xl">
          One tour becomes a <em className="text-rose">daydream</em> of their day.
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
          {GALLERY_FRAMES.map((f) => (
            <ContactFrame key={f.index} frame={f} />
          ))}
        </div>
        <p className="mono-label mt-6 text-muted-foreground/70 normal-case tracking-[0.08em]">
          Frames from sample glimpse galleries
        </p>
      </section>
    );
  }

  return <PinnedContactSheet />;
}

function PinnedContactSheet() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ["start start", "end end"] });

  const sheetScale = useTransform(scrollYProgress, [0, 0.28], [0.62, 1]);
  const exposureOpacity = useTransform(scrollYProgress, [0.6, 0.72], [1, 0]);
  const deliveredOpacity = useTransform(scrollYProgress, [0.72, 0.84], [0, 1]);

  return (
    <section ref={trackRef} className="relative" style={{ height: "300vh" }}>
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden px-10">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <SceneLabel index="003" title="The deliverable" />
            <h2 className="mt-6 font-display text-[clamp(1.8rem,3vw,2.8rem)] font-normal tracking-[-0.03em] leading-tight">
              One tour becomes a <em className="text-rose">daydream</em> of their day.
            </h2>
          </div>
          <div className="relative w-80 shrink-0 text-right">
            <motion.p style={{ opacity: exposureOpacity }} className="mono-label text-muted-foreground">
              Developing…
            </motion.p>
            <motion.p style={{ opacity: deliveredOpacity }} className="mono-label absolute inset-0 text-rose">
              Delivered — booking link attached
            </motion.p>
          </div>
        </div>

        <motion.div style={{ scale: sheetScale }} className="origin-center">
          <div className="grid grid-cols-4 gap-5">
            {GALLERY_FRAMES.map((f, i) => (
              <DealtFrame key={f.index} frame={f} index={i} progress={scrollYProgress} />
            ))}
          </div>
        </motion.div>
        <p className="mono-label mt-6 text-muted-foreground/70 normal-case tracking-[0.08em]">
          Frames from sample glimpse galleries
        </p>
      </div>
    </section>
  );
}

function DealtFrame({
  frame,
  index,
  progress,
}: {
  frame: (typeof GALLERY_FRAMES)[number];
  index: number;
  progress: MotionValue<number>;
}) {
  // Frame 01 is the exposure — always present. 02–04 deal in one by one.
  const start = 0.18 + index * 0.14;
  const opacity = useTransform(progress, [start, start + 0.1], index === 0 ? [1, 1] : [0, 1]);
  const x = useTransform(progress, [start, start + 0.1], index === 0 ? [0, 0] : [56, 0]);

  return (
    <motion.div style={{ opacity, x }}>
      <ContactFrame frame={frame} />
    </motion.div>
  );
}

/* ————————————————— 004 · Mechanism (horizontal) ————————————————— */

const MECHANISM_STEPS = [
  {
    index: "01",
    title: "The tour ends",
    text: "Your QR card or link goes home with the couple.",
  },
  {
    index: "02",
    title: "They add three photos",
    text: "Your branded page. Their portraits. One style pick.",
  },
  {
    index: "03",
    title: "glimpse develops the gallery",
    text: "Four photoreal portraits in your venue, plus a branded motion reel.",
  },
  {
    index: "04",
    title: "The booking step arrives with it",
    text: "Delivered while they're deciding — your venue's name and booking link on the share page.",
  },
];

function MechanismScene() {
  const reduce = useReducedMotion();
  const wide = useIsWide();

  if (reduce || !wide) {
    return (
      <section className="border-t border-border px-5 py-24 md:px-10">
        <SceneLabel index="004" title="How it works" />
        <h2 className="mt-10 font-display text-[clamp(2rem,4.5vw,4rem)] font-normal tracking-[-0.03em] leading-[1.05]">
          The 48 hours <em className="text-rose">after</em> the tour.
        </h2>
        <ol className="mt-14 space-y-14">
          {MECHANISM_STEPS.map((s) => (
            <li key={s.index} className="border-t border-border pt-6">
              <span className="text-stroke-rose font-display text-6xl leading-none">{s.index}</span>
              <h3 className="mt-4 mb-3 font-sans text-xl font-bold tracking-tight">{s.title}</h3>
              <p className="max-w-xl font-light leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return <HorizontalMechanism />;
}

function HorizontalMechanism() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], ["0vw", `-${(MECHANISM_STEPS.length - 1) * 100}vw`]);
  const rail = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  return (
    <section ref={trackRef} className="relative border-t border-border" style={{ height: "340vh" }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <div className="absolute left-10 top-24 z-20 w-[28rem] max-w-[80vw]">
          <SceneLabel index="004" title="How it works — drag of the scroll" />
        </div>

        <motion.div style={{ x }} className="flex h-full" aria-label="How glimpse works, four steps">
          {MECHANISM_STEPS.map((s, i) => (
            <div
              key={s.index}
              className={cn(
                "relative flex h-screen w-screen shrink-0 items-center px-[10vw]",
                i % 2 === 1 && "bg-wine",
              )}
            >
              <span
                aria-hidden
                className="text-stroke pointer-events-none absolute right-[4vw] top-1/2 -translate-y-1/2 select-none font-display leading-none text-[34vh]"
              >
                {s.index}
              </span>
              <div className="relative z-10 max-w-xl">
                <p className="mono-label mb-6 text-rose">Step {s.index} / 04</p>
                <h3 className="mb-6 font-display text-[clamp(2.4rem,4.4vw,4.2rem)] font-normal tracking-[-0.03em] leading-[1.02]">
                  {s.title}
                </h3>
                <p className="text-lg font-light leading-relaxed text-muted-foreground">{s.text}</p>
              </div>
            </div>
          ))}
        </motion.div>

        <div className="absolute inset-x-10 bottom-10 z-20">
          <div className="h-px w-full bg-border">
            <motion.div className="h-px origin-left bg-rose" style={{ scaleX: rail }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ————————————————— 005 · Guardrails ————————————————— */

const GUARDRAILS = [
  {
    index: "01",
    title: "More toured couples book",
    text: "Personal, vivid follow-up lands while the decision is still open — not another thank-you email.",
  },
  {
    index: "02",
    title: "Marketing assets, made for you",
    text: "Every gallery ships as a branded share page and motion reel — ready to reuse in your follow-up emails, ads, and socials.",
  },
  {
    index: "03",
    title: "Your brand does the traveling",
    text: "Couples pass the gallery to parents and friends. Your venue's name and booking step travel with every share.",
  },
];

function GuardrailScene() {
  return (
    <section className="border-t border-border px-5 py-24 md:px-10 md:py-32">
      <SceneLabel index="005" title="What it does for the business" />
      <h2 className="mt-10 mb-16 max-w-4xl font-display text-[clamp(2rem,4.5vw,4rem)] font-normal tracking-[-0.03em] leading-[1.05]">
        Follow-up that <em className="text-rose">sells the date.</em>
      </h2>
      <div>
        {GUARDRAILS.map((g) => (
          <div
            key={g.index}
            data-cursor="focus"
            className="group grid grid-cols-[3rem_1fr] items-baseline gap-4 border-t border-border py-8 transition-colors duration-300 last:border-b hover:bg-wine md:grid-cols-[6rem_1fr_1.2fr] md:gap-10 md:px-4"
          >
            <span className="mono-label text-rose">{g.index}</span>
            <h3 className="font-display text-2xl font-medium leading-tight transition-transform duration-300 md:text-3xl md:group-hover:translate-x-2">
              {g.title}
            </h3>
            <p className="col-start-2 max-w-xl font-light leading-relaxed text-muted-foreground md:col-start-3">
              {g.text}
            </p>
          </div>
        ))}
      </div>
      <p className="mono-label mt-8 text-muted-foreground/70 normal-case tracking-[0.08em]">
        Likeness reviewed before every send · you approve every gallery · failed renders refund the credit
      </p>
    </section>
  );
}

/* ————————————————— 006 · The offer ————————————————— */

function OfferScene({ onStart }: { onStart: () => void }) {
  return (
    <section className="grain relative overflow-hidden border-t border-border px-5 py-28 text-center md:px-10 md:py-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_50%_100%,hsl(var(--rose)/0.12),transparent_70%)]"
      />
      <div className="relative z-10">
        <p className="mono-label mb-10 text-rose">006 — The offer</p>
        <h2 className="display-editorial font-light leading-[0.94] text-[clamp(2.8rem,8.5vw,8rem)]">
          One link.
          <br />
          <em className="text-rose">Every tour.</em>
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-lg font-light leading-relaxed text-muted-foreground">
          Hand the link to the next couple who tours. Add credits when the
          bookings follow.
        </p>
        <Magnetic className="mt-12 inline-block">
          <TickButton onClick={onStart} size="xl" testId="venue-trial-register">
            Create your venue workspace
          </TickButton>
        </Magnetic>
      </div>
    </section>
  );
}

/* ————————————————— Footer ————————————————— */

function Footer({ onStart }: { onStart: () => void }) {
  return (
    <footer className="border-t border-border bg-wine">
      <div className="px-5 pb-10 pt-16 md:px-10">
        <button
          type="button"
          onClick={onStart}
          data-cursor="focus"
          className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Create your venue workspace"
        >
          <span className="display-editorial lowercase leading-[0.85] tracking-[-0.045em] text-[clamp(4rem,17vw,17rem)] text-foreground/95 transition-colors hover:text-rose">
            glimpse<span className="text-rose">.</span>
          </span>
        </button>
        <div className="mt-12 flex flex-col gap-6 border-t border-border/60 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="mono-label text-muted-foreground">
            A glimpse of their day — in your venue
          </p>
          <nav className="flex items-center gap-8">
            <a href="/couple" className="mono-label text-muted-foreground transition-colors hover:text-foreground">
              For couples
            </a>
            <a href="/login" className="mono-label text-muted-foreground transition-colors hover:text-foreground">
              Sign in
            </a>
          </nav>
          <p className="mono-label text-muted-foreground/70">
            © {new Date().getFullYear()} glimpse
          </p>
        </div>
      </div>
    </footer>
  );
}

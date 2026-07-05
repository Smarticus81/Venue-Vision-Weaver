import { useEffect, useRef, useState, type ReactNode } from "react";
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
  RiseLines,
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

      <header className="fixed inset-x-0 top-0 z-50 mix-blend-normal">
        <div className="flex items-center justify-between px-5 md:px-10 h-16 md:h-20 border-b border-border/60 bg-background/70 backdrop-blur-md">
          <GlimpseLogo href="/" />
          <p className="mono-label hidden md:block text-muted-foreground">
            For wedding venues — film no. 001
          </p>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setLocation("/login")}
              className="mono-label text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="venue-header-sign-in"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setLocation("/create-venue")}
              className="mono-label border border-foreground/40 px-4 py-2.5 text-foreground hover:border-rose hover:text-rose transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="venue-header-register"
            >
              Start free
            </button>
          </div>
        </div>
      </header>

      <main>
        <HeroScene onStart={() => setLocation("/create-venue")} onSignIn={() => setLocation("/login")} />
        <ProblemScene />
        <DevelopingPrintScene />
        <MechanismScene />
        <GuardrailScene />
        <OfferScene onStart={() => setLocation("/create-venue")} />
      </main>

      <Footer onStart={() => setLocation("/create-venue")} />
    </div>
  );
}

/* ————————————————— 001 · Manifesto hero ————————————————— */

function HeroScene({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  return (
    <section className="grain relative flex min-h-screen flex-col justify-end overflow-hidden pt-24">
      <img
        src={BRAND_ASSETS.heroAtmosphere}
        alt=""
        aria-hidden
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover opacity-70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/55 via-background/70 to-background"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_70%_10%,hsl(var(--rose)/0.1),transparent_70%)]"
      />

      <div className="relative z-10 px-5 md:px-10">
        <p className="mono-label mb-6 text-rose">For wedding venues</p>
        <h1 className="font-display font-medium uppercase leading-[0.92] tracking-[-0.02em] text-[clamp(3.2rem,11.5vw,11.5rem)]">
          <RiseLines lines={["Turn tours", <>into{" "}<em className="text-rose">bookings.</em></>]} />
        </h1>

        <div className="mt-8 grid grid-cols-1 gap-10 pb-16 md:mt-12 md:grid-cols-[1fr_auto] md:items-end md:pb-20">
          <p className="font-display italic text-[clamp(1.6rem,3.4vw,3rem)] leading-tight text-muted-foreground max-w-3xl">
            Couples see their wedding <span className="text-foreground">in your rooms</span> — before they decide.
          </p>

          <div className="max-w-sm md:justify-self-end">
            <p className="mb-6 text-base leading-relaxed text-muted-foreground">
              After each tour, glimpse sends the couple four photoreal portraits
              of themselves in your venue, plus a branded motion reel — with
              your booking link on it.
            </p>
            <TickButton onClick={onStart} testId="venue-hero-register">
              Start with 5 free galleries
            </TickButton>
            <p className="mono-label mt-5 text-muted-foreground/80 normal-case tracking-normal text-[0.72rem]">
              No card. No contract. 1 credit = 1 couple's gallery.
            </p>
            <button
              type="button"
              onClick={onSignIn}
              className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="owner-cta"
            >
              Already set up? Sign in
            </button>
          </div>
        </div>
      </div>

      <Marquee className="relative z-10 border-y border-border py-4 md:py-6" speed={30}>
        {["more bookings", "faster yeses", "follow-up that sells", "four portraits + a reel"].map((t) => (
          <span key={t} className="mx-6 inline-flex items-baseline gap-12 font-display italic text-[clamp(1.6rem,3.2vw,3rem)] leading-none text-foreground/90">
            {t}
            <span aria-hidden className="inline-block h-[0.5em] w-[0.5em] translate-y-[-0.05em] rounded-full bg-rose/70" />
          </span>
        ))}
      </Marquee>
    </section>
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
          <h2 className="font-display text-[clamp(2.2rem,5vw,4.6rem)] leading-[1.05] font-medium">
            Every tour ends with{" "}
            <em className="text-rose">"we'll think about it."</em>
          </h2>
          <div className="space-y-6 self-end text-lg font-light leading-relaxed text-muted-foreground max-w-md">
            <p>
              Then they tour three more venues, and every unbooked tour is
              revenue you already paid to earn — the ads, the inquiry, the
              walkthrough.
            </p>
            <p>
              The venue that stays vivid wins the date. Photos of{" "}
              <em className="font-display text-foreground">them</em> in your
              rooms stay vivid.
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
        <h2 className="mt-10 mb-12 font-display text-[clamp(2rem,4.5vw,4rem)] leading-[1.05] font-medium max-w-3xl">
          One tour becomes a <em className="text-rose">contact sheet</em> of their day.
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
            <h2 className="mt-6 font-display text-[clamp(1.8rem,3vw,2.8rem)] font-medium leading-tight">
              One tour becomes a <em className="text-rose">contact sheet</em> of their day.
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
    text: "Four photoreal portraits in your rooms, plus a branded motion reel.",
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
        <h2 className="mt-10 font-display text-[clamp(2rem,4.5vw,4rem)] font-medium leading-[1.05]">
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
                <h3 className="mb-6 font-display text-[clamp(2.4rem,4.4vw,4.2rem)] font-medium leading-[1.02]">
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
      <h2 className="mt-10 mb-16 max-w-4xl font-display text-[clamp(2rem,4.5vw,4rem)] font-medium leading-[1.05]">
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
        <h2 className="font-display font-medium leading-[0.98] text-[clamp(2.8rem,8.5vw,8rem)]">
          Five galleries.
          <br />
          <em className="text-rose">On us.</em>
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-lg font-light leading-relaxed text-muted-foreground">
          Hand the link to the next couple who tours. No card, no subscription —
          add credits when the bookings follow.
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
          <span className="font-display font-medium lowercase leading-[0.85] tracking-[-0.03em] text-[clamp(4rem,17vw,17rem)] text-foreground/95 transition-colors hover:text-rose">
            glimpse<span className="text-rose">.</span>
          </span>
        </button>
        <div className="mt-12 flex flex-col gap-6 border-t border-border/60 pt-8 md:flex-row md:items-center md:justify-between">
          <p className="mono-label text-muted-foreground">
            A glimpse of their day — in your rooms
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

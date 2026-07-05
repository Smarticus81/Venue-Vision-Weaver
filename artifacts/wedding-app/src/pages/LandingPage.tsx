import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { DarkroomCursor, FrameTicks, Marquee, RiseLines } from "@/components/motion";
import { toVenueSlug } from "@/lib/venueSlug";

const STEPS = [
  {
    index: "01",
    title: "Upload portraits",
    desc: "Add up to three photos. We preserve your exact likeness.",
  },
  {
    index: "02",
    title: "Choose a style",
    desc: "Pick the editorial look that feels closest to your celebration.",
  },
  {
    index: "03",
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
    <div className="min-h-screen overflow-x-clip bg-background text-foreground font-sans flex flex-col">
      <DarkroomCursor />

      <header className="fixed inset-x-0 top-0 z-50">
        <div className="flex h-16 items-center justify-between border-b border-border/60 bg-background/70 px-5 backdrop-blur-md md:h-20 md:px-10">
          <GlimpseLogo href="/couple" />
          <p className="mono-label hidden md:block text-muted-foreground">
            For couples — your frame awaits
          </p>
          <button
            type="button"
            onClick={() => setLocation("/find-my-gallery")}
            className="mono-label text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            data-testid="couple-header-find-gallery"
          >
            Find my gallery
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — typographic, paints statically. */}
        <section className="grain relative flex min-h-screen flex-col justify-end overflow-hidden pt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_30%_10%,hsl(var(--rose)/0.1),transparent_70%)]"
          />

          <div className="relative z-10 px-5 md:px-10">
            <p className="mono-label mb-6 text-rose">Your venue sent you here</p>
            <h1 className="font-display font-medium uppercase leading-[0.92] tracking-[-0.02em] text-[clamp(2.9rem,9.5vw,9.5rem)]">
              <RiseLines
                lines={[
                  "See yourselves",
                  <>
                    there <em className="text-rose">first.</em>
                  </>,
                ]}
              />
            </h1>

            <div className="mt-8 grid grid-cols-1 gap-10 pb-16 md:mt-12 md:grid-cols-[1fr_auto] md:items-end md:pb-20">
              <p className="max-w-2xl font-display italic text-[clamp(1.4rem,2.8vw,2.4rem)] leading-tight text-muted-foreground">
                Four portraits of the two of you, inside the venue you just toured.
              </p>

              {/* The venue-code ticket */}
              <div className="relative w-full max-w-md bg-card p-8 md:justify-self-end">
                <FrameTicks size={16} className="text-foreground/40" />
                <p className="mono-label mb-5 text-rose">Your venue code</p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="e.g. oak-ridge-estate"
                      value={venueCode}
                      onChange={(e) => setVenueCode(e.target.value)}
                      className="h-14 rounded-none border-input bg-background pl-12 text-base focus-visible:ring-ring"
                      data-testid="couple-venue-code"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!slugReady}
                    data-cursor="focus"
                    className="group inline-flex h-14 w-full items-center justify-center gap-3 bg-rose text-base font-medium text-rose-foreground transition-colors duration-200 hover:bg-rose-hover disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
                    data-testid="couple-venue-go"
                  >
                    Continue
                    <ArrowRight className="h-5 w-5 transition-transform duration-200 ease-out group-hover:translate-x-1.5" />
                  </button>
                </form>
                <p className="mono-label mt-5 text-muted-foreground/80 normal-case tracking-normal text-[0.72rem]">
                  The code is on your venue's QR card or welcome email.
                </p>
                <button
                  type="button"
                  className="mt-3 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  onClick={() => setLocation("/find-my-gallery")}
                  data-testid="couple-find-gallery-home"
                >
                  Already created a gallery? Find it with your email
                </button>
              </div>
            </div>
          </div>

          <Marquee className="relative z-10 border-y border-border py-4 md:py-5" speed={32}>
            {["your likeness, kept", "your venue, real", "one private link", "four frames + a reel"].map((t) => (
              <span
                key={t}
                className="mx-6 inline-flex items-baseline gap-12 font-display italic text-[clamp(1.4rem,2.6vw,2.4rem)] leading-none text-foreground/90"
              >
                {t}
                <span aria-hidden className="inline-block h-[0.5em] w-[0.5em] translate-y-[-0.05em] rounded-full bg-rose/70" />
              </span>
            ))}
          </Marquee>
        </section>

        {/* Steps as an index */}
        <section className="px-5 py-24 md:px-10 md:py-32">
          <div className="flex items-center gap-4 border-t border-border pt-4">
            <span className="mono-label text-rose">Steps</span>
            <span className="mono-label text-muted-foreground">Your glimpse in three</span>
          </div>
          <div className="mt-14">
            {STEPS.map((step) => (
              <div
                key={step.index}
                data-cursor="focus"
                className="group grid grid-cols-[3rem_1fr] items-baseline gap-4 border-t border-border py-8 transition-colors duration-300 last:border-b hover:bg-wine md:grid-cols-[6rem_1fr_1.2fr] md:gap-10 md:px-4"
              >
                <span className="text-stroke-rose font-display text-4xl leading-none md:text-5xl">
                  {step.index}
                </span>
                <h3 className="font-display text-2xl font-medium leading-tight transition-transform duration-300 md:text-3xl md:group-hover:translate-x-2">
                  {step.title}
                </h3>
                <p className="col-start-2 max-w-xl font-light leading-relaxed text-muted-foreground md:col-start-3">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-wine px-5 py-10 md:px-10">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <p className="mono-label text-muted-foreground">A glimpse of your day</p>
          <p className="mono-label text-muted-foreground/70">© {new Date().getFullYear()} glimpse</p>
        </div>
      </footer>
    </div>
  );
}

import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { BRAND_ASSETS, GALLERY_FRAMES } from "@/lib/brandAssets";

/*
 * Conversion spine: this page exists to get a wedding-venue owner or sales
 * manager to create a venue account, because a couple who sees themselves
 * married in the venue before they leave the tour is more likely to book it.
 *
 * Proof is deliberately a placeholder (see PROOF_SLOTS). No invented stats,
 * testimonials, or customer names: replace a slot with a real quote or a
 * real number when a venue agrees to share one.
 */

const VALUE_POINTS = [
  {
    title: "Your real rooms",
    body: "Images are built from photos you upload of your own ceremony, reception, and outdoor spaces. Not stock, not a lookalike.",
  },
  {
    title: "Their real faces",
    body: "The couple adds two or three photos of themselves. Each image is checked for likeness before it reaches anyone.",
  },
  {
    title: "Your booking link",
    body: "Every gallery carries your venue name and your tour or booking link, and you review it before it is sent.",
  },
] as const;

const STEPS = [
  {
    title: "Set up once",
    body: "Upload photos of your spaces and add your booking link. That is the whole setup.",
  },
  {
    title: "Hand the couple your link at the end of the tour",
    body: "They scan your QR code or open your link, add a few photos of themselves, and pick a style. You can also start it for them from your dashboard.",
  },
  {
    title: "They see themselves married at your venue",
    body: "A few minutes later they get four images and a short reel by email, while your venue is still fresh. Most couples send it straight to their parents and friends.",
  },
  {
    title: "You review, then follow up",
    body: "Every gallery lands in your dashboard first. Check the likeness, send it, and your booking link is right there when they are ready.",
  },
] as const;

/** Placeholders for real proof. Swap in a quote or a number with the venue's permission. */
const PROOF_SLOTS = [
  {
    label: "Reserved for a venue quote",
    body: "A few sentences from a venue owner about what changed in their follow-up, with their name and venue.",
  },
  {
    label: "Reserved for booking numbers",
    body: "A venue's tour-to-booking rate before and after, over a stated period, shared with their permission.",
  },
] as const;

const PLANS = [
  {
    name: "Starter",
    body: "One venue running regular tours.",
    detail: "25 galleries a month.",
  },
  {
    name: "Growth",
    body: "Several venues, or one with a full tour calendar.",
    detail: "100 galleries a month.",
  },
  {
    name: "Credit pack",
    body: "Ten extra galleries for a busy weekend.",
    detail: "One-time, added to your plan.",
  },
] as const;

export default function VenueLandingPage() {
  return (
    <div className="site-page">
      <div className="hero-band">
        <SiteHeader />
        <main id="main-content">
          <section className="venue-hero page-width">
            <div className="hero-copy">
              <p className="eyebrow">For wedding venues</p>
              <h1>
                Turn tours
                <br />
                into <em>bookings.</em>
              </h1>
              <p className="hero-description">
                A couple tours your venue. Before they leave, they see
                realistic images and a short reel of themselves getting
                married there. They send it to family. They are more likely
                to pick you.
              </p>
              <div className="action-row">
                <Link
                  href="/create-venue"
                  className="action-primary"
                  data-testid="venue-hero-register"
                >
                  Start free <ArrowRight size={18} />
                </Link>
                <a href="#how-it-works" className="text-link">
                  See how it works
                </a>
              </div>
              <p className="hero-note">
                <Check size={15} aria-hidden /> Five galleries free when you
                sign up. No card needed.
              </p>
            </div>
            <figure className="hero-photo">
              <img
                src={BRAND_ASSETS.heroAtmosphere}
                alt="A couple walking through a sunlit garden venue, generated from the venue's own photos"
                fetchPriority="high"
                width="1200"
                height="900"
              />
              <figcaption>
                <span>Example gallery image</span>
                <span>AI-generated</span>
              </figcaption>
            </figure>
          </section>
        </main>
      </div>

      <section className="value-strip page-width" aria-label="What makes it work">
        <div>
          {VALUE_POINTS.map((point) => (
            <div key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="experience" className="page-width section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">What the couple gets</p>
            <h2>Four images and one short reel, at your venue.</h2>
          </div>
          <p>
            Delivered to a private page that carries your venue name and your
            booking link. The couple can save it, share it, and come back to
            it.
          </p>
        </div>
        <div className="sample-gallery">
          {GALLERY_FRAMES.map((frame, i) => (
            <figure key={frame.index}>
              <img
                src={frame.src}
                alt={frame.alt}
                loading="lazy"
                width="600"
                height="750"
              />
              <figcaption>
                <span>0{i + 1}</span>
                {frame.label}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="caption">
          Example gallery, AI-generated. Each couple's gallery is made from
          their own photos and your venue's photos.
        </p>
      </section>

      <section id="how-it-works" className="ink-section">
        <div className="how-section page-width">
          <div>
            <p className="eyebrow">How it works</p>
            <h2>Add it to the end of every tour.</h2>
            <p className="mt-4 max-w-md text-base leading-relaxed">
              The tour already does the hard work. Dreemer gives the couple
              something to take home that puts them in your space.
            </p>
            <Link href="/create-venue" className="text-link mt-6">
              Set up your venue <ArrowRight size={17} />
            </Link>
          </div>
          <ol className="journey-list">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="proof-section page-width" aria-labelledby="proof-heading">
        <div className="proof-grid">
          <div>
            <p className="eyebrow">Results</p>
            <h2 id="proof-heading">Numbers, not adjectives.</h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-foreground/80">
              Dreemer is new. We would rather show one venue's real
              before-and-after booking rate than invent a statistic. As venues
              report results, they go here, named and with permission.
            </p>
          </div>
          <div className="grid gap-4">
            {PROOF_SLOTS.map((slot) => (
              <div key={slot.label} className="proof-slot">
                <p className="eyebrow">{slot.label}</p>
                <p>{slot.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="plans-section page-width" aria-labelledby="plans-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Plans</p>
            <h2 id="plans-heading">A monthly plan, plus credits when you need them.</h2>
          </div>
          <p>
            One credit is one couple's gallery. Credits are shared across every
            venue on your account. Prices are shown at checkout in your
            dashboard.
          </p>
        </div>
        <ul>
          {PLANS.map((plan) => (
            <li key={plan.name}>
              <h3>{plan.name}</h3>
              <p>{plan.body}</p>
              <p>{plan.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="start-section page-width">
        <p className="eyebrow">Start today</p>
        <h2>Give the next couple a reason to pick you.</h2>
        <Link
          href="/create-venue"
          className="action-primary"
          data-testid="venue-trial-register"
        >
          Start free <ArrowRight size={18} />
        </Link>
        <p className="caption">
          Five galleries free. Setup is your venue photos and your booking link.
        </p>
        <Link href="/login" className="text-link" data-testid="venue-trial-sign-in">
          Already set up? Sign in
        </Link>
      </section>
      <SiteFooter />
    </div>
  );
}

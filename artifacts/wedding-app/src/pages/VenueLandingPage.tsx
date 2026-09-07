import { ArrowRight, Check, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { BRAND_ASSETS, GALLERY_FRAMES } from "@/lib/brandAssets";
export default function VenueLandingPage() {
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content">
        <section className="venue-hero page-width">
          <div className="hero-copy">
            <p className="eyebrow">A new perspective for wedding venues</p>
            <h1>
              They’ve seen your venue.
              <br />
              <em>
                Now let them see
                <br />
                their day.
              </em>
            </h1>
            <p className="hero-description">
              Turn a lovely tour into something personal. Give every couple a
              wedding gallery starring them, in the place they could say yes.
            </p>
            <div className="action-row">
              <Link
                href="/create-venue"
                className="action-primary"
                data-testid="venue-hero-register"
              >
                Create your venue <ArrowRight size={18} />
              </Link>
              <a href="#experience" className="text-link">
                Explore the experience <ArrowUpRight size={16} />
              </a>
            </div>
            <p className="hero-note">
              <Check size={15} /> 4 AI portraits + a motion reel, in every
              gallery
            </p>
          </div>
          <figure className="hero-photo">
            <img
              src={BRAND_ASSETS.heroAtmosphere}
              alt="A couple imagining their wedding in a sunlit garden venue"
              fetchPriority="high"
              width="1200"
              height="900"
            />
            <figcaption>
              <span>YOUR SPACE. THEIR STORY.</span>
              <span>AI-generated illustration</span>
            </figcaption>
          </figure>
        </section>
        <section className="value-strip">
          <div className="page-width">
            <p>
              A follow-up they can <em>picture.</em>
            </p>
            <span>Your venue’s real spaces</span>
            <span>The couple’s own likeness</span>
            <span>Your booking link, included</span>
          </div>
        </section>
        <section id="experience" className="page-width experience-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">From possibility to picture</p>
              <h2>
                A little glimpse.
                <br />A much more personal connection.
              </h2>
            </div>
            <p>
              Four portraits, one motion reel, and a share page that keeps your
              venue in the conversation. Here’s a sample of what couples
              receive.
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
            Illustrative AI-generated gallery. Every couple’s result is created
            from their photos and your venue references.
          </p>
        </section>
        <section id="how-it-works" className="how-section page-width">
          <div>
            <p className="eyebrow">Made for the moment after a tour</p>
            <h2>
              You open the door.
              <br />
              <em>We help them imagine.</em>
            </h2>
            <Link href="/create-venue" className="text-link">
              Set up your venue <ArrowRight size={17} />
            </Link>
          </div>
          <ol className="journey-list">
            {[
              [
                "Make it yours",
                "Add photos of your venue and the link where couples can take their next step.",
              ],
              [
                "Share the invitation",
                "Give couples your venue link or QR code. They add their photos and choose a style.",
              ],
              [
                "Keep the possibility alive",
                "Their personal gallery brings your venue home with them, ready to revisit and share.",
              ],
            ].map(([title, desc], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="start-section page-width">
          <p className="eyebrow">A more memorable next step</p>
          <h2>
            Let the next tour
            <br />
            end with a glimpse.
          </h2>
          <Link
            href="/create-venue"
            className="action-primary"
            data-testid="venue-trial-register"
          >
            Create your venue <ArrowRight size={18} />
          </Link>
          <p className="caption">One credit creates one couple’s gallery.</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

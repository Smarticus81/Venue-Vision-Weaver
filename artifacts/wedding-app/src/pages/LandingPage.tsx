import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { toVenueSlug } from "@/lib/venueSlug";
import { BRAND_ASSETS } from "@/lib/brandAssets";
export default function LandingPage() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="couple-entry page-width">
        <div className="entry-photo">
          <img
            src={BRAND_ASSETS.heroAtmosphere}
            alt="A couple in a sunlit garden venue, generated from the venue’s photos"
            width="1200"
            height="900"
          />
          <span>See yourselves married at the venue you just toured.</span>
        </div>
        <section>
          <p className="eyebrow">For couples</p>
          <h1>
            Picture your day
            <br />
            in the real place.
          </h1>
          <p>
            Your venue shared a code or link with you. Enter it to make four
            images and a short reel of the two of you, there.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const slug = toVenueSlug(code);
              if (slug) navigate(`/preview/${slug}`);
            }}
          >
            <label htmlFor="venue-code">Venue code or link</label>
            <Input
              id="venue-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. the-willow-house"
              data-testid="couple-venue-code"
              aria-describedby="code-help"
            />
            <p id="code-help" className="caption">
              It is on the venue’s QR card or in the email they sent you.
            </p>
            <Button
              type="submit"
              disabled={!toVenueSlug(code)}
              data-testid="couple-venue-go"
            >
              Find my venue <ArrowRight />
            </Button>
          </form>
          <Link
            href="/find-my-gallery"
            className="text-link"
            data-testid="couple-find-gallery-home"
          >
            Already made a gallery? Find it here <ArrowRight size={16} />
          </Link>
          <ol className="entry-steps">
            <li>
              <span>01</span> Add your photos
            </li>
            <li>
              <span>02</span> Choose your style
            </li>
            <li>
              <span>03</span> Get your gallery by email
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

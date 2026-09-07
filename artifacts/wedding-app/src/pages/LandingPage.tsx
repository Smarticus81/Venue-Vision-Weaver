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
            alt="A wedding day imagined in a sunlit garden"
            width="1200"
            height="900"
          />
          <span>Your day starts with a possibility.</span>
        </div>
        <section>
          <p className="eyebrow">For the two of you</p>
          <h1>
            What if
            <br />
            <em>this was your day?</em>
          </h1>
          <p>
            See yourselves in the venue you’ve been dreaming about. Start with
            the code or link your venue shared.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const slug = toVenueSlug(code);
              if (slug) navigate(`/preview/${slug}`);
            }}
          >
            <label htmlFor="venue-code">Your venue code or link</label>
            <Input
              id="venue-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. the-willow-house"
              data-testid="couple-venue-code"
              aria-describedby="code-help"
            />
            <p id="code-help" className="caption">
              Find it on your venue’s QR card or welcome email.
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
              <span>03</span> Meet your wedding day
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

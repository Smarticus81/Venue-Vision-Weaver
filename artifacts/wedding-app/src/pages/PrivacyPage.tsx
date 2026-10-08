import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { usePublicConfig } from "@/lib/publicConfig";

/*
 * /privacy: how Dreemer handles couple photos, venue photos and AI previews.
 * Plain words, specific commitments only. Figures (retention window, contact
 * address) come from the public config so this page never drifts from what
 * the product actually does.
 */
export default function PrivacyPage() {
  const config = usePublicConfig();
  const { retentionDays, contactEmail } = config;
  const contact = contactEmail ? (
    <a href={`mailto:${contactEmail}`} className="text-link">
      {contactEmail}
    </a>
  ) : (
    <span>the venue that made your gallery, or the address in the footer of your gallery email</span>
  );

  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="prose-page page-width">
        <header className="page-intro">
          <p className="eyebrow">Privacy &amp; AI previews</p>
          <h1>How Dreemer handles photos</h1>
          <p>
            Dreemer makes a small private gallery for a couple who toured a wedding venue: four
            images and a short reel of them at that venue, generated from their own photos and the
            venue's own photos. This page says exactly what we do with those photos and what we do not.
          </p>
        </header>

        <nav aria-label="On this page" className="page-toc">
          <a href="#ai-previews">AI previews</a>
          <a href="#consent">Consent</a>
          <a href="#retention">Retention</a>
          <a href="#rights">Who owns the images</a>
          <a href="#sharing">Who can see a gallery</a>
          <a href="#venues">Venue photos and dashboards</a>
          <a href="#site">This website</a>
          <a href="#delete">Deleting your data</a>
        </nav>

        <section id="ai-previews">
          <h2>Every generated image is an AI preview</h2>
          <p>
            The images and the reel are not photographs of the couple at the venue. They are AI
            previews, generated at the couple's request from two or three photos of themselves and
            the venue's photos of its spaces. Every image and the reel are labelled "AI preview,
            imagined at {"{the venue}"}" wherever they appear, and the real photo of the space sits
            beside each one. The venue's architecture is never altered; only the couple, the light
            and the decor are generated.
          </p>
          <p>
            Each image is checked for likeness before the gallery is delivered. If the check fails,
            the image is re-rendered or the gallery is not delivered, and the venue's credit is
            refunded.
          </p>
        </section>

        <section id="consent">
          <h2>Consent from both partners</h2>
          <p>
            A couple's gallery is only made when the people in the photos agree. Before upload, the
            couple confirms that both partners consent to their photos being used to make the
            gallery. When a venue coordinator starts a gallery for a couple on tour day, the
            coordinator records that consent on the couple's behalf, and the couple receives the
            gallery by email so they can see and delete it.
          </p>
        </section>

        <section id="retention">
          <h2>Source photos are deleted after {retentionDays} days</h2>
          <p>
            The photos a couple uploads are used only to make their gallery. They are deleted{" "}
            {retentionDays} days after the gallery is delivered. We store no face templates, embeddings
            or biometric profiles: once the source photos are gone, nothing about the couple's
            appearance remains except the finished gallery they own.
          </p>
          <p>
            The generated images and reel stay available at the couple's private link until the
            couple or the venue asks us to delete them.
          </p>
        </section>

        <section id="rights">
          <h2>The couple owns the images</h2>
          <p>
            The gallery is made at the couple's request, for the couple. The venue that paid for the
            gallery receives no rights to reuse the images or the reel in its marketing unless the
            couple agrees in writing. Dreemer does not use any couple's photos or gallery to train
            models or to advertise.
          </p>
        </section>

        <section id="sharing">
          <h2>Galleries are private links</h2>
          <p>
            A gallery lives at a private link. Only people with the link can open it. Nothing is
            public unless the couple shares the link, and the page tells search engines not to index
            it. The venue sees the gallery in its own dashboard so it can check the likeness and
            follow up.
          </p>
        </section>

        <section id="venues">
          <h2>Venue photos and what venues can see</h2>
          <p>
            A venue uploads photos of its own spaces, or lets us pull them from its public website for
            it to confirm. Those photos are used as references for that venue's galleries and nothing
            else. Venues can delete them at any time.
          </p>
          <p>
            For each gallery, the venue's dashboard shows when it was sent, whether it was opened,
            shared or used to check a date, and whether the venue marked the date as booked. The
            couple's email address and the wedding month they told us are shown to the venue so it
            can follow up; they are not shared with any other venue.
          </p>
          <p>
            A venue can opt in to share anonymised, aggregated results (opens, date clicks, bookings
            across all its galleries) on dreemer.co. No couple is ever identifiable in those figures.
          </p>
        </section>

        <section id="site">
          <h2>This website</h2>
          <p>
            We use no advertising trackers or third-party analytics. To understand which emails and
            links bring venues to us, we keep a note in your browser of how you first arrived (for
            example a link in an email we sent you) and record which pages and buttons venues use on
            the way to signing up. Signed-in sessions are handled by our authentication provider,
            Clerk; payments are handled by Stripe, and we never see card numbers.
          </p>
        </section>

        <section id="delete">
          <h2>Delete on request</h2>
          <p>
            A couple can ask for their gallery and anything we hold about them to be deleted at any
            time. A venue can delete its photos, its galleries and its account from the dashboard,
            or ask us to. Write to {contact} and we will confirm when it is done.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

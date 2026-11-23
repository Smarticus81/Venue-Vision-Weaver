import { Link } from "wouter";
import { track } from "@/lib/track";

const STEPS = [
  {
    title: "Set up once",
    body: "Import or upload your venue photos, confirm the spaces, and add your date link. Check a sample before inviting couples.",
  },
  {
    title: "End the tour with the card",
    body: "The couple scans it, adds two or three photos of themselves, picks a look and tells you their month. Or your coordinator does it for them on a phone in tour-day mode.",
  },
  {
    title: "They see themselves married at your venue",
    body: "Dreemer builds four personalized stills and a motion reel. You can review the gallery before delivery; the couple gets a private link to revisit and share.",
  },
  {
    title: "They check their date. You see it happen.",
    body: "The gallery ends with your date link. Your dashboard shows who opened, shared and clicked, and you mark the booking when it lands.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="ink-section">
      <div className="how-section page-width">
        <div>
          <p className="eyebrow">How it works</p>
          <h2>From a venue visit<br />to a personal keepsake.</h2>
          <p className="section-copy">
            The tour already does the hard work. Dreemer gives the couple something to take home that
            puts them in your space, and gives you a reason to follow up the same day.
          </p>
          <Link
            href="/create-venue"
            className="text-link mt-6"
            onClick={() => track("cta_click", { placement: "how_it_works" })}
          >
            Set up your venue
          </Link>
        </div>
        <ol className="journey-list">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span aria-hidden>0{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

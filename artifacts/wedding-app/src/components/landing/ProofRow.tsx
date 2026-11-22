import type { PublicConfig } from "@workspace/api-client-react";

/*
 * Proof row (funnel-ux.md 3.4). Partner mode until enough venues opt in to
 * share anonymised results; then the server flips config.proof.mode to
 * "aggregate" and the right card becomes three real figures. No invented
 * numbers in either mode.
 */
export function ProofRow({ config }: { config: PublicConfig }) {
  const { proof, founding, contactEmail } = config;
  const aggregates = proof.mode === "aggregate" ? proof.aggregates ?? null : null;
  const showFounding = Boolean(founding && contactEmail);

  return (
    <section className="proof-section page-width" aria-labelledby="proof-heading" id="proof">
      <div className="proof-grid">
        <div>
          <p className="eyebrow">Measure what happens next</p>
          <h2 id="proof-heading">Follow the interest.<br />Learn what works.</h2>
          {aggregates ? (
            <p className="section-copy">
              These figures come from venues that opted in to share anonymised results. They update as
              galleries are opened, shared and booked.
            </p>
          ) : (
            <p className="section-copy">
              See which galleries were opened, which couples clicked to check a date, and which
              bookings your team records. Compare the results with your own tour history—booking
              improvements are not guaranteed.
            </p>
          )}
        </div>

        {aggregates ? (
          <div className="proof-card proof-figures" aria-label="Results shared by opted-in venues">
            <dl>
              <div>
                <dt>opened their gallery</dt>
                <dd className="text-brand">{aggregates.openedRate}%</dd>
              </div>
              <div>
                <dt>clicked to check a date</dt>
                <dd>{aggregates.ctaClickRate}%</dd>
              </div>
              <div>
                <dt>booked dates recorded by venues</dt>
                <dd>{aggregates.bookedCount}</dd>
              </div>
            </dl>
            <p className="caption">
              Across {aggregates.venues} venues and {aggregates.galleries} galleries that opted in to
              share results{aggregates.since ? `, since ${formatSince(aggregates.since)}` : ""}.
            </p>
          </div>
        ) : showFounding && founding && contactEmail ? (
          <div className="proof-card">
            <p className="eyebrow">
              Founding venues · {founding.slotsLeft} of {founding.slotsTotal} places
            </p>
            <h3>Growth free for 90 days.</h3>
            <p>
              For {founding.slotsTotal} venues who run Dreemer on real tours this season and share
              their tour-to-booking numbers before and after, plus one quote we may print with your
              name. You keep the galleries either way.
            </p>
            <a
              className="action-secondary"
              href={`mailto:${contactEmail}?subject=${encodeURIComponent("Founding venue")}`}
            >
              Apply as a founding venue
            </a>
          </div>
        ) : null}
      </div>

    </section>
  );
}

function formatSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

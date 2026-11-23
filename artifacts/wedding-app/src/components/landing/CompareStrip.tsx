import { COMPARE_IMAGES } from "@/lib/brandAssets";

/*
 * Explain inputs, outputs and human review responsibilities. Illustrative
 * imagery is labelled; no unverified competitor or fidelity guarantees.
 */

const COLUMNS = ["You provide", "Dreemer creates", "You review"] as const;

const ROWS: Array<{ label: string; cells: [string, string, string] }> = [
  {
    label: "The couple",
    cells: ["Two or three clear photos, with both partners' consent", "Personalized previews guided by their photos", "Both partners' likeness and natural details"],
  },
  {
    label: "The setting",
    cells: ["Photos of your venue's real spaces", "Wedding scenes using those spaces as references", "Architecture, layout and recognizable features"],
  },
  {
    label: "The gallery",
    cells: ["Your venue details and date link", "Four stills and a motion reel on a private-link page", "The complete result before sending, if enabled"],
  },
  {
    label: "The follow-up",
    cells: ["Your team's booking updates", "Gallery activity in your dashboard", "Opens, date-link clicks and recorded bookings"],
  },
];

export function CompareStrip() {
  return (
    <section className="compare-section page-width" aria-labelledby="compare-heading" id="compare">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Built from what makes you, you</p>
          <h2 id="compare-heading">Your real venue.<br />A carefully imagined day.</h2>
        </div>
      </div>

      <div className="compare-pair" aria-label="The room, then the couple in it">
        <figure>
          <img
            src={COMPARE_IMAGES.room.src}
            width={COMPARE_IMAGES.room.width}
            height={COMPARE_IMAGES.room.height}
            alt={COMPARE_IMAGES.room.alt}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span>Example source photo</span>
            The room
          </figcaption>
        </figure>
        <figure>
          <img
            src={COMPARE_IMAGES.couple.src}
            width={COMPARE_IMAGES.couple.width}
            height={COMPARE_IMAGES.couple.height}
            alt={COMPARE_IMAGES.couple.alt}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span>Illustrative generated preview</span>
            The couple in the room
          </figcaption>
        </figure>
      </div>

      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">What</span>
            </th>
            {COLUMNS.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, i) => (
                <td key={COLUMNS[i]} data-col={COLUMNS[i]} className={i === 2 ? "is-dreemer" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">Generated previews can change details or likeness. Preview your results; these images are inspirations, not photographs or promises of the finished event.</p>
    </section>
  );
}

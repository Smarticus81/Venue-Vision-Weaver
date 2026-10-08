import { COMPARE_IMAGES } from "@/lib/brandAssets";

/*
 * Compare strip (funnel-ux.md 3.8). The 2-up at the top is the reveal hero's
 * fallback: the two halves of the committed diptych side by side, handle
 * hidden, because no same-composition before/after pair exists yet. No
 * competitor names; AI previews are labelled as previews.
 */

const COLUMNS = ["360° virtual tours", "Decor renderers", "Dreemer"] as const;

const ROWS: Array<{ label: string; cells: [string, string, string] }> = [
  {
    label: "Who is in the picture",
    cells: ["Nobody", "Nobody, new decor", "This couple, likeness-checked"],
  },
  {
    label: "When the couple sees it",
    cells: ["Before the tour", "During the tour", "Minutes after the tour, at home, with family"],
  },
  {
    label: "Where it ends",
    cells: ["Your website", "A download", "Your date link, with their month"],
  },
  {
    label: "Your rooms",
    cells: ["Unchanged", "Restyled", "Unchanged: only the couple, light and decor"],
  },
];

export function CompareStrip() {
  return (
    <section className="compare-section page-width" aria-labelledby="compare-heading" id="compare">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Compare</p>
          <h2 id="compare-heading">Room renderers show the room. Dreemer shows the couple in the room.</h2>
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
            <span>What a room renderer shows</span>
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
            <span>What the couple takes home · AI preview</span>
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
      <p className="caption">AI previews are labelled as previews everywhere they appear.</p>
    </section>
  );
}

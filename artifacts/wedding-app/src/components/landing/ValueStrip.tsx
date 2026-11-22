const VALUE_POINTS = [
  {
    title: "Your real rooms",
    body: "Your ceremony, reception and outdoor photos guide the rendering. Review your sample for an accurate sense of place.",
  },
  {
    title: "Their real faces",
    body: "Two or three clear photos guide both partners' likeness. Quality checks and owner review help catch mismatches.",
  },
  {
    title: "Your date link",
    body: "Every gallery ends with one button: check your date at your venue. It carries the month they told us.",
  },
  {
    title: "You see who booked",
    body: "Sent, opened, shared, clicked for a date, booked, per couple, in your dashboard. One click marks a booking.",
  },
] as const;

export function ValueStrip() {
  return (
    <section className="value-strip page-width" aria-label="What makes it work">
      <ul>
        {VALUE_POINTS.map((point) => (
          <li key={point.title}>
            <h3>{point.title}</h3>
            <p>{point.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

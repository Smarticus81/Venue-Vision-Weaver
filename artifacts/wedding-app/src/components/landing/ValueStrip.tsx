const VALUE_POINTS = [
  {
    title: "Your real rooms",
    body: "Images are built from photos of your own ceremony, reception and outdoor spaces. We never change your architecture, only the couple, the light and the decor.",
  },
  {
    title: "Their real faces",
    body: "The couple adds two or three photos of themselves. Every image is checked for likeness before you see it.",
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

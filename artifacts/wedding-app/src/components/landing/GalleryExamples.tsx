import { useState } from "react";
import { GALLERY_FRAMES } from "@/lib/brandAssets";

const examples = GALLERY_FRAMES.slice(0, 3);
const descriptions = [
  "The walk down the aisle. The familiar room, imagined for a new beginning.",
  "The first dance. A different mood, with the couple at the heart of the scene.",
  "A moment outside. The light, the setting, and a glimpse of what could be.",
];

/** A user-controlled album: no timer, carousel or fake before/after slider. */
export function GalleryExamples() {
  const [selected, setSelected] = useState(0);
  const frame = examples[selected]!;
  return (
    <section className="album-examples page-width" id="gallery-examples" aria-labelledby="examples-heading">
      <div className="album-examples__intro">
        <p className="eyebrow">A feeling, made visible</p>
        <h2 id="examples-heading">More personal<br />than a brochure.</h2>
        <p>Give each couple their own way to imagine the day. Not just photographs of a beautiful place—pictures with them in it.</p>
        <ul className="album-delivery">
          <li><strong>Four stills</strong><span>A personal gallery to revisit</span></li>
          <li><strong>One motion reel</strong><span>A short film made from their gallery</span></li>
          <li><strong>Your next step</strong><span>Your venue's date or enquiry link</span></li>
        </ul>
        <p className="album-examples__note">Illustrative AI examples from demo scenes. Results vary; evaluate a sample in your own venue before sharing with couples.</p>
      </div>
      <div className="album-viewer">
        <div className="album-viewer__label"><span>The wedding album</span><span>AI preview</span></div>
        <figure id="example-selected" aria-live="polite" aria-atomic="true">
          <img key={frame.src} src={frame.src} alt={frame.alt} width={600} height={750} loading="lazy" decoding="async" />
          <figcaption><h3>{frame.label}</h3><p>{descriptions[selected]}</p></figcaption>
        </figure>
        <div className="album-choices" role="group" aria-label="Choose an example scene">
          {examples.map((example, index) => (
            <button key={example.src} type="button" aria-pressed={selected === index} aria-controls="example-selected"
              onClick={() => setSelected(index)}>
              <img src={example.src} alt="" width={72} height={90} loading="lazy" decoding="async" />
              <span>{example.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

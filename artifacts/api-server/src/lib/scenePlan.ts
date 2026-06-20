import type { ReferenceAspectRatio } from "./referenceImage.js";
import type { GalleryStyle } from "./galleryStyles.js";

export interface WeddingScene {
  id: string;
  title: string;
  aspectRatio: ReferenceAspectRatio;
  /** What the couple is doing and how they are framed. */
  coupleAction: string;
  /** Which venue feature should anchor this frame. */
  venueBeat: string;
}

const GALLERY_SCENES: WeddingScene[] = [
  {
    id: "portrait-vertical",
    title: "The Portrait",
    aspectRatio: "3:4",
    coupleAction:
      "Editorial vertical wedding portrait of the two people from the couple references. They stand close together in refined wedding attire, both faces clearly visible, looking toward the camera with natural expressions and realistic body proportions.",
    venueBeat:
      "Center them inside the venue's most photogenic interior space, with real architecture, chandeliers, columns, materials, and warm light clearly visible behind them.",
  },
  {
    id: "intimate-moment",
    title: "Quiet Moment",
    aspectRatio: "4:3",
    coupleAction:
      "Close intimate wedding portrait of the same couple. They stand forehead to forehead with relaxed smiles, hands gently connected, both faces unobstructed and sharp.",
    venueBeat:
      "Frame a soft signature detail of the venue behind them, such as stained glass, sconce, wood beams, florals, stonework, or another uploaded architectural detail, softly out of focus.",
  },
  {
    id: "grand-venue",
    title: "Grand Venue",
    aspectRatio: "16:9",
    coupleAction:
      "Wide architectural wedding photograph. The same couple stands together, hand in hand, small enough to showcase the venue but large enough for both faces and silhouettes to remain recognizable.",
    venueBeat:
      "The venue dominates the frame. Preserve its full architecture, scale, materials, lighting, and signature elements from the uploaded references.",
  },
  {
    id: "celebration",
    title: "Forever Begins",
    aspectRatio: "3:4",
    coupleAction:
      "Joyful celebration portrait of the same couple laughing naturally together in elegant wedding attire. Their expressions, face shapes, hair, skin tones, and builds match the references exactly.",
    venueBeat:
      "Use the venue's warmest natural-light view or exterior anchor, with venue architecture visible behind them and subtle celebration energy in the air.",
  },
];

export function planGalleryScenes(): WeddingScene[] {
  return GALLERY_SCENES;
}

export function buildSceneKontextPrompt(
  scene: WeddingScene,
  style: GalleryStyle,
): string {
  const lines = [
    `Photorealistic ${style.name} wedding gallery image.`,
    "IDENTITY LOCK: use the two adult people from the couple reference images as the only couple in the output. Preserve exact likeness: face shape, eyes, eyebrows, nose, mouth, jawline, ears, hair color, hair texture, hair length, glasses, freckles, moles, skin tone, age, build, and natural expression. Do not beautify, slim, de-age, face-swap, or replace either person.",
    "VENUE LOCK: place them inside or around the exact wedding venue shown in the venue references. Preserve real architecture, materials, lighting, decor, scale, and signature details. Do not invent a generic ballroom, chapel, hotel, garden, or studio.",
    "COMPOSITING LOCK: match perspective, lens feel, light direction, contact shadows, ambient color, and scale so the couple appears photographed in the venue, not pasted on top.",
    `COUPLE STAGING: ${scene.coupleAction}`,
    `VENUE STAGING: ${scene.venueBeat}`,
    `DIRECTOR: ${style.directorNotes.slice(0, 380)}`,
    `MOOD: ${style.mood.slice(0, 140)}`,
    `AVOID: ${style.avoid.slice(0, 160)}. No extra people, no text, no captions, no watermarks, no logos, no distorted hands, no obscured faces, no changed venue.`,
  ];
  return clamp(lines.join("\n"), 1800);
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd();
}

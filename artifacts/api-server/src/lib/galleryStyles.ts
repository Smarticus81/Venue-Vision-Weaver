export interface GalleryStyle {
  id: string;
  name: string;
  /** Short user-facing one-liner shown in the style picker. */
  description: string;
  directorNotes: string;
  sceneBeats: string;
  mood: string;
  avoid: string;
}

export const GALLERY_STYLES: GalleryStyle[] = [
  {
    id: "cinematic-editorial",
    name: "Cinematic Editorial",
    description: "Polished venue editorial with warm light, natural posing, and refined depth.",
    directorNotes:
      "Premium wedding editorial photographed with natural lens depth, soft directional light, gentle highlight bloom, realistic skin texture, and strong architectural respect for the venue. Keep the space recognizable and elegant without making it look staged or artificial.",
    sceneBeats:
      "Signature venue architecture, natural couple interaction, refined portrait composition, warm ambient light, and a sales-ready sense of place.",
    mood: "Joyful, tender, timeless, and venue-forward.",
    avoid:
      "Oversaturation, plastic skin, uncanny smiles, symmetrical AI-face artifacts, generic venues, heavy retouching, and fashion poses that obscure likeness.",
  },
  {
    id: "heirloom-memory",
    name: "Heirloom Memory",
    description: "Warm nostalgic gallery with gentle grain, soft contrast, and intimate texture.",
    directorNotes:
      "Documentary-inspired wedding portraiture with subtle grain, soft contrast, warm color, imperfect human warmth, and tactile venue details. Faces remain crisp and recognizable while the background has an heirloom softness.",
    sceneBeats:
      "Handheld-feeling portraits, quiet venue corners, architectural details, soft smiles, and warm natural light.",
    mood: "Warm, intimate, nostalgic, and emotionally grounded.",
    avoid:
      "Digital sharpness, harsh flash, heavy blur over faces, fake vintage damage, changed facial features, and generic location swaps.",
  },
  {
    id: "golden-hour-dream",
    name: "Golden Hour Dream",
    description: "Romantic amber light, painterly bokeh, and luminous venue atmosphere.",
    directorNotes:
      "Dreamlike wedding portraiture bathed in amber natural light, soft backlight, painterly bokeh, gentle haze, and clean face detail. Make the couple feel naturally present in the venue instead of composited into a fantasy background.",
    sceneBeats:
      "Honey-warm venue views, soft architectural silhouettes, romantic close portraits, and graceful celebration energy.",
    mood: "Romantic, luminous, calm, and aspirational.",
    avoid:
      "Harsh shadows, cool color casts, over-smoothed faces, blown-out venue details, fantasy castles, and unreadable facial likeness.",
  },
];

export function findGalleryStyle(id: string | null | undefined): GalleryStyle | null {
  if (!id) return null;
  return GALLERY_STYLES.find((style) => style.id === id) ?? null;
}

interface PublicGalleryStyle {
  id: string;
  name: string;
  description: string;
}

export function listPublicGalleryStyles(): PublicGalleryStyle[] {
  return GALLERY_STYLES.map(({ id, name, description }) => ({ id, name, description }));
}

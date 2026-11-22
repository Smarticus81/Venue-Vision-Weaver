# Dreemer brand

Dreemer helps venue teams give touring couples a personalized AI wedding
gallery and a clear path back to the venue. The images are imagined previews,
not photographs of a real wedding or guarantees of venue fidelity or bookings.

Tagline: **Let them see their day here.**
Direction: **blue-hour wedding album** — midnight ink, silver paper and a
restrained lavender accent. Calm, architectural and photographic.

## Source of truth

| Surface | Source |
| --- | --- |
| Colors, type, shape, motion and brand copy | `lib/brand/src/tokens.ts` |
| Generated CSS | `lib/brand/tokens.css` |
| Custom vector mark and wordmark | `lib/brand/src/logo.ts` |
| Email roles and mark | `lib/brand/src/email.ts` |
| Export scripts | `lib/brand/scripts/build-logo.ts`, `build-og.ts` |
| Contrast and exported-artwork tests | `lib/brand/src/tokens.test.ts`, `logo.test.ts` |

Web, email and reel renderers import this package. Add a semantic token before
introducing a color in a consumer. Legacy `coral` and `ivory` export names
remain for compatibility: they now resolve to lavender and pearl/silver,
not the previous coral-and-cream palette.

## Color roles

| Role | Value | Usage |
| --- | --- | --- |
| Midnight ink | `#202A44` | Primary text, wordmark, dark surfaces |
| Pearl paper | `#F7F8FC` | Main canvas |
| Silver | `#E8ECF4` | Bands, email background, app tiles |
| Pale lavender | `#C6C4FA` | Primary action fill with midnight text |
| Deep lavender | `#5351A2` | Accent text, light-surface mark, focus ring |
| Muted ink | `#58647B` | Supporting text and captions |

Use semantic roles (`canvas`, `text`, `accent`, `accentText`, `focusRing`)
rather than scale values in new UI. Pale lavender is not body text on a light
surface. Accent occupies roughly a tenth of a screen; status colors have
meaning, never a decorative role. Existing sea, success, warning and error
scales remain in the shared module. Contrast tests assert AA text pairings
on each supported light surface and dark email surface, including buttons'
hover and active states.

## Typography

Outfit carries the geometric wordmark into headings and figures; Figtree is
the interface and body face. System monospace is reserved for IDs and
operator data. Both variable web faces are self-hosted Latin WOFF2 subsets
under `artifacts/wedding-app/public/fonts/`, preloaded by `index.html`,
with `font-display: swap`. No third-party font request blocks the web app.

Emails use the shared fallback stack. The deterministic social-card generator
uses system Arial/Helvetica for copy and the custom vector wordmark; it needs
no browser or network font download.

Use sentence case, plain verbs and real numbers. Buttons describe the action.
Marketing examples must be visibly labelled as AI previews. Do not claim
measured booking lift, exact likeness or unchanged architecture without evidence.

## Layout and motion

The public landing page pairs left-aligned copy with an arched photographic
portrait. The mobile order is copy, primary action, then photography. The
signature interaction is a user-controlled contact sheet: native buttons,
visible selection and a short opacity transition. No automatic carousel,
scroll hijacking, background video or motion library on the landing route.
Reduced-motion users get an instant scene change.

Product controls retain shared compact radii; the landing CTA may use a pill
and album media larger rounded/arched corners. Focus uses a 2px deep-lavender
outline with a 3px offset. Preserve touch targets and native video controls.

## Logo

The mark is an architectural D enclosing an open arched doorway. Its outer
counter uses even-odd fill in every renderer. The lowercase wordmark is custom
monoline geometry (150-unit ascender, 14-unit stroke, 20-unit letter spacing):
never substitute a font or stretch its proportions.

- Color: deep-lavender mark with midnight wordmark.
- Ink: monochrome midnight.
- Reversed: pale-lavender mark and pearl wordmark on midnight.
- Small favicons: the outer D alone, without the interior door.
- Larger app icons: the full architectural mark, with maskable safe insets.

Keep clear space at least a quarter of the mark's width around the lockup;
at compact sizes use the mark alone when the wordmark cannot remain legible.
Do not add the tagline inside the lockup. React consumers use
`DreemerLogo`; all exports use the same geometry.

## Rebuild and verify

```sh
pnpm --filter @workspace/brand run build
pnpm --filter @workspace/brand run build:logo
pnpm --filter @workspace/brand run build:og
pnpm run test:brand
```

Commit the generated assets and public copies together. The social card's SVG
embeds a PNG derived from the committed illustrative WebP, since SVG
rasterizers do not consistently decode embedded WebP. Its tests check dimensions
and photo-region variance to catch silently missing images. Logo tests check
the D counter and raster aspect ratios. Visual inspection remains necessary.

## Deliberate leftovers from the rename

These still say `glimpse` on purpose. Each has a safe path if the name must
go:

| Where | Why it stays | Migration path |
| --- | --- | --- |
| Supabase bucket defaults `glimpse` / `glimpse-public` in `artifacts/api-server/src/lib/objectStorage.ts`, `scripts/setup-supabase-storage.cjs`, `.env.example`, `railway.env.template` | Live venue photos and generated galleries sit in those buckets; renaming the default would point production at empty buckets. | Create `dreemer` / `dreemer-public` buckets, copy objects (Supabase Storage `move`/`copy` per object or `supabase storage cp`), set `SUPABASE_STORAGE_BUCKET` / `SUPABASE_PUBLIC_BUCKET` in Railway, verify `/api/readyz`, then change the defaults and delete the old buckets. |
| The regex in `scripts/src/security-smoke.ts` that asserts the Railway template still names those buckets | Guards the row above. | Update together with the row above. |

Database tables and columns never carried the old name.

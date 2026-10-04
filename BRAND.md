# Dreemer brand

Dreemer sells to wedding venue owners. A couple touring a venue uploads a few
photos and gets realistic images and a short reel of themselves getting
married in that exact venue. Venue owners care about one thing: more tours
turning into booked dates. Everything below serves that.

**Theme:** Turn tours into bookings.
**Feel:** calm, confident, warm, modern, premium. A business tool, not a
wedding blog. No decorative hearts, rings, script faces, gold foil, or
glitter.

## Where the tokens live

One module, imported by every surface:

| | Path |
| --- | --- |
| Source of truth (TypeScript) | `lib/brand/src/tokens.ts` |
| Generated CSS custom properties (`--dm-*`) | `lib/brand/tokens.css` (`pnpm --filter @workspace/brand run build`) |
| Logo geometry | `lib/brand/src/logo.ts` |
| Logo files (SVG, PNG, ICO, OG card) | `lib/brand/assets/logo/` (`build:logo`, `build:og`) |
| Contrast tests | `lib/brand/src/tokens.test.ts` (`pnpm --filter @workspace/brand run test`) |

Consumers:

- **Web app** – `artifacts/wedding-app/src/index.css` imports
  `@workspace/brand/tokens.css` and maps the variables onto Tailwind's theme
  (`bg-primary`, `text-brand`, `bg-band`, `text-success`, …). Components that
  need a raw value (Clerk appearance, QR colors, the error boundary) import
  from `@workspace/brand`.
- **Emails, reel title card, QA page** – `artifacts/api-server` imports
  `semantic`, `font`, `brand` and the logo geometry from `@workspace/brand`.
  esbuild bundles it into the server build.

Add a token before you add a color. Never write a hex value in a page.

## Color

Values are sRGB hex. Every text pairing listed here passes WCAG AA (4.5:1)
and is asserted by the test suite; the ratios below are from that run.

### Coral — the signature accent

| Token | Hex | Use |
| --- | --- | --- |
| `coral.500` | `#F07B64` | The mark. Primary action fill. Running / active indicators. |
| `coral.600` | `#D8634C` | Primary action hover. |
| `coral.700` | `#A8412D` | Coral **as text** on ivory (4.6:1 on `ivory.200`, 5.2:1 on `ivory.100`). Also the focus ring. |
| `coral.400` | `#F28D77` | Coral on ink surfaces (8:1 on `ink.900`). |
| `coral.50` / `100` | `#FDF1ED` / `#FBDFD7` | Soft tints, text selection. |

Coral never carries body text on a light surface: `coral.500` on ivory is
2.2:1. Reach for `coral.700` (`text-brand` in the app) when the words need
to read as coral. Keep coral under about a tenth of any screen: one primary
button per view, the eyebrow or figure that matters, nothing else.

### Ink — text

| Token | Hex | Use |
| --- | --- | --- |
| `ink.900` | `#061219` | Headlines, body, icons, dark surfaces, the wordmark. |
| `ink.600` | `#425056` | Secondary text (6.7:1 on `ivory.200`). |
| `ink.500` | `#56656B` | Muted text and placeholders (4.6:1 on `ivory.200`). |
| `ink.300` | `#98A3A6` | Muted text on ink surfaces (7.3:1 on `ink.900`). |
| `ink.800` / `700` | `#17262D` / `#2C3A41` | Raised surface and hairlines on ink. |

### Ivory — surfaces

| Token | Hex | Use |
| --- | --- | --- |
| `ivory.200` | `#E9E6DB` | **Brand ivory.** Hero band, workspace sidebar, email body, app-icon tile. |
| `ivory.100` | `#F6F4EE` | Page canvas for product screens. |
| `ivory.50` | `#FCFBF8` | Cards, email card. |
| `ivory.0` | `#FFFFFF` | Inputs, popovers, modals. |
| `ivory.300` / `400` | `#DCD8CA` / `#C9C4B2` | Hairlines / strong borders and input borders. |

### Sea — the secondary color

A cool counterweight to the warm page. `sea.600` `#25645E` for links in
running text and secondary emphasis (5.5:1 on `ivory.200`); `sea.700`
`#1E524D` hover; `sea.50` `#EEF5F4` tint. Charts and informational states
use the sea scale before they ever borrow coral.

### Status

| Role | Text (AA on ivory) | Fill | Soft tint |
| --- | --- | --- | --- |
| Success | `#1E6E43` | `#26804F` (white text, 4.5:1) | `#DCEFE2` |
| Warning | `#7A5200` | `#E2A42B` (ink text, 8.6:1) | `#FBECC6` |
| Error | `#A82E28` | `#C9403A` (white text, 4.9:1) | `#F9DDD9` |

Status colors carry meaning only: a "ready" pill, a failed render, a low
credit balance. They are never decoration.

### Semantic roles

`semantic` in `tokens.ts` names the roles the UI should actually reach for:
`canvas`, `band`, `surface`, `surfaceRaised`, `border`, `borderStrong`,
`text`, `textSecondary`, `textMuted`, `textOnAccent`, `accent`,
`accentHover`, `accentText`, `secondary`, `focusRing`, `successText`, …
and the `ink*` roles for dark surfaces. Retheme a role once; every surface
follows.

## Type

| Role | Face | Weights | Notes |
| --- | --- | --- | --- |
| Display (`font.display`) | **Outfit** | 500, 600 | Geometric, matches the constructed wordmark. Headlines, large figures. Tracking −0.025em, leading 1.08–1.2. |
| Body (`font.body`) | **Figtree** | 400, 500, 600 | Same geometric family feel, better at 13–16px. Everything else. Leading 1.6. |
| Mono (`font.mono`) | system monospace | — | IDs, links shown as text, operator-console labels. |

Both are open-source via Google Fonts (`fontImportUrl` in `tokens.ts`; the
same URL is in `index.html` so the display face is requested early). Email
uses the `font.email` stack and degrades to Helvetica/Arial.

Scale (px, 1.25 ratio): 12, 14, 16, 18, 20, 25, 31, 39, 49, 61. Labels
(`.eyebrow`) are 12px Figtree 600, uppercase, +0.08em tracking, muted ink.

Writing style is part of the type system: sentence case everywhere, plain
verbs, short sentences, numbers only when they are real. Buttons say what
happens ("Start free", "Email gallery", "Create gallery").

## Shape, elevation, motion

- Radii: 4 (xs), 6 (sm), 8 (md: buttons, inputs), 12 (lg: cards), 20 (xl:
  hero media, bands). Nothing is a full pill except badge counts.
- Shadows are rare: `shadow.md` on hero media and modals, nothing on cards
  (cards use a 1px `ivory.300` border on the canvas instead).
- Motion: 150ms for hover, 220ms for state changes, 420ms for section
  reveals, easing `cubic-bezier(0.16, 1, 0.3, 1)`. Transform and opacity
  only. `prefers-reduced-motion` collapses everything to instant.
- Focus: 2px `coral.700` outline, 3px offset, on every interactive element.

## Logo

The mark is the left lobe of a soft coral heart: a rounded top-left, a
straight edge into the notch, a straight edge out to the right corner and
down to the point, and a gentle curve back up the left side. A thin coral
line leaves the notch and traces where the right lobe would be, ending open
on the right, with a small two-stroke spark at its peak, top right. The
wordmark is a lowercase monoline geometric "dreemer" built from circles and
stems (x-height 100, ascender 150, stroke 22), matched to the original
render's weight and spacing, so it renders identically everywhere without
a web font. The original render lives at
`lib/brand/assets/logo/dreemer-logo-midjourney.png`.

Variants, all generated from `lib/brand/src/logo.ts`:

- `dreemer-lockup-{color,ink,reversed}.svg` — mark + wordmark. Default.
- `dreemer-icon-{color,ink,reversed}.svg` — mark alone (avatars, favicons).
- `dreemer-wordmark-{color,ink,reversed}.svg` — text alone.
- `color` = coral mark + ink wordmark; `ink` = everything ink; `reversed` =
  coral mark + ivory wordmark on an ink background.
- App icons, favicon (`.svg` and `.ico`), apple-touch-icon, maskable icon
  and the 1200×630 OG card live beside them and are copied into
  `artifacts/wedding-app/public/` by the same scripts.

Rules: clear space equal to the mark's width on all sides; minimum lockup
height 20px; below 32px use the simplified tile (hairline and spark replaced
by a solid star). Never
recolor the mark outside the three variants, never set the wordmark in a
font, never add a tagline inside the lockup.

In React use `<DreemerLogo variant="lockup|mark|wordmark" tone="color|mono" />`
from `@/components/brand/DreemerLogo`; it reads the same geometry.

## Deliberate leftovers from the rename

These still say `glimpse` on purpose. Each has a safe path if the name must
go:

| Where | Why it stays | Migration path |
| --- | --- | --- |
| Supabase bucket defaults `glimpse` / `glimpse-public` in `artifacts/api-server/src/lib/objectStorage.ts`, `scripts/setup-supabase-storage.cjs`, `.env.example`, `railway.env.template` | Live venue photos and generated galleries sit in those buckets; renaming the default would point production at empty buckets. | Create `dreemer` / `dreemer-public` buckets, copy objects (Supabase Storage `move`/`copy` per object or `supabase storage cp`), set `SUPABASE_STORAGE_BUCKET` / `SUPABASE_PUBLIC_BUCKET` in Railway, verify `/api/readyz`, then change the defaults and delete the old buckets. |
| The regex in `scripts/src/security-smoke.ts` that asserts the Railway template still names those buckets | Guards the row above. | Update together with the row above. |

Database tables and columns never carried the old name.

# Dreemer logo files

Every file in this folder is generated from `lib/brand/src/logo.ts` by
`pnpm --filter @workspace/brand run build:logo` (SVG, PNG, ICO) and
`pnpm --filter @workspace/brand run build:og` (the social card). Edit the
geometry or the tokens, re-run the scripts, and commit the output — do not
hand-edit the exports.

| File | Use |
| --- | --- |
| `dreemer-icon-{color,ink,reversed}.svg` | The mark alone. `reversed` carries its own ink background. |
| `dreemer-wordmark-{color,ink,reversed}.svg` | The lowercase wordmark alone. |
| `dreemer-lockup-{color,ink,reversed}.svg` | Horizontal lockup: mark + wordmark. The default for headers and documents. |
| `dreemer-lockup-*@2x.png`, `dreemer-icon-*-512.png` | Raster exports for decks and partners who cannot take SVG. |
| `dreemer-lockup-email.png` | 560px lockup referenced by transactional email headers. |
| `dreemer-tile-{light,dark}.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | App icons (web manifest, iOS home screen). |
| `favicon.svg`, `favicon.ico`, `dreemer-favicon.svg` | Browser tab icons. Simplified mark: the thin orbit line is dropped below 32px. |
| `og-image.png` (+ `og-image.html` source) | 1200×630 Open Graph / Twitter card. |

The web app's deploy copies (`artifacts/wedding-app/public/`) are written by
the same scripts, so the two locations cannot drift.

## Reference artwork

The brief's original Midjourney render (`dreemer-logo-midjourney.png`) was
not attached to the task that produced these files. Drop it into this folder
under that name when it is available; the SVGs above were constructed from
the written description (soft coral mark, thin coral line and spark at the
top right, lowercase geometric sans wordmark in near-black ink on warm ivory)
and should be checked against it.

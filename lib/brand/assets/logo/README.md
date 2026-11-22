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
| `favicon.svg`, `favicon.ico`, `dreemer-favicon.svg` | Browser tab icons. Simplified outer D without the interior door. |
| `og-image.png` (+ generated `og-image.svg`) | 1200×630 Open Graph / Twitter card. |

The web app's deploy copies (`artifacts/wedding-app/public/`) are written by
the same scripts, so the two locations cannot drift.

## Reference artwork

`dreemer-logo-midjourney.png` is retained historical artwork, not the current
identity. The active mark is an original architectural D enclosing an open
arched doorway, constructed on a 100-unit grid in `lib/brand/src/logo.ts`.
The lighter custom lowercase wordmark needs no font file. See `BRAND.md`
for the blue-hour palette and usage rules.

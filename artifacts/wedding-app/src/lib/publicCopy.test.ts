import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("marketing copy leads with the product, not technology labels", () => {
  for (const file of ["../pages/VenueLandingPage.tsx", "../../index.html", "../components/landing/Hero.tsx", "../components/landing/Faq.tsx"]) {
    assert.doesNotMatch(read(file), /\bAI\b|AI-powered/, file);
  }
  assert.match(read("../pages/VenueLandingPage.tsx"), /Turn tours<br\/>into <span>bookings\.<\/span>/);
  assert.match(read("../pages/VenueLandingPage.tsx"), /Personalized previews\. Private galleries\. Better follow-up\./);
});

test("plain-language disclosures and both-partner consent remain", () => {
  const couple = read("../pages/CouplePage.tsx");
  assert.match(couple, /generated previews, not photographs/);
  assert.match(couple, /We both agree\./);
  assert.match(couple, /data-testid="couple-consent"/);
  assert.match(couple, /make generated preview images/);
  assert.match(read("../pages/GallerySharePage.tsx"), /generated preview, imagined at/);
  assert.match(read("../pages/PrivacyPage.tsx"), /not photographs of the couple at the venue/);
});

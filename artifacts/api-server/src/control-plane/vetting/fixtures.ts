import { stripTags } from "../outreach/venueResearch.js";
import type { DnsInfo, FetchedSite, TlsInfo } from "./checks.js";
import { parseCdx, parseRdap, type VettingDeps } from "./deps.js";
import { PLACES_SEARCH_URL } from "./places.js";

/**
 * Offline fixtures for the vetting suite (vetting.md section 10). No network:
 * every dependency the checks consume is built from the HTML/JSON below.
 */

export const NOW = new Date("2026-10-08T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

export const WILLOW_URL = "https://www.willowhouseweddings.test/";
export const WILLOW_CONTACT_URL = "https://www.willowhouseweddings.test/contact";
export const WILLOW_EMAIL = "dana@willowhouseweddings.test";
export const WILLOW_PHONE = "(518) 555-0142";

export const WILLOW_HOME_HTML = `<!doctype html><html lang="en"><head>
<title>Willow House | Weddings in Hudson, NY</title>
<meta name="description" content="A restored 1850s farmhouse and barn on 40 acres along the Hudson River." />
<meta property="og:site_name" content="Willow House" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"EventVenue","name":"Willow House","telephone":"+1 518-555-0142","url":"https://www.willowhouseweddings.test/","address":{"@type":"PostalAddress","streetAddress":"214 River Road","addressLocality":"Hudson","addressRegion":"NY","postalCode":"12534","addressCountry":"US"}}</script>
</head><body>
<header><nav><a href="/">Home</a> <a href="/weddings">Weddings</a> <a href="/contact">Contact</a> <a href="/about">About us</a></nav></header>
<h1>Weddings at Willow House</h1>
<p>Willow House is a restored farmhouse and barn on forty acres along the Hudson River. We host weddings, ceremonies and receptions from May through October for couples who want the whole weekend in one place, with room for everyone to stay on the property.</p>
<img src="/images/hero-barn.jpg" alt="The Barn at golden hour" width="1600" height="900" />
<h2>The Barn</h2>
<p>Seats up to 180 guests for dinner and dancing under the original hand-hewn beams, with the doors open to the meadow.</p>
<h2>The Garden Terrace</h2>
<p>Ceremonies under the pergola, with the river behind the bride and groom and the orchard to one side.</p>
<img src="/images/gallery/terrace.jpg" alt="Garden Terrace reception" width="1400" height="900" />
<p>Dana Whitfield, Owner, has run Willow House since 2014 and still gives every tour herself.</p>
<p>As seen on <a href="https://www.theknot.com/marketplace/willow-house-hudson-ny-123">The Knot</a>. Follow us on <a href="https://instagram.com/willowhouse">Instagram</a> and <a href="https://www.facebook.com/willowhouseweddings">Facebook</a>.</p>
<footer><p>Willow House · 214 River Road, Hudson, NY 12534 · (518) 555-0142 · <a href="mailto:dana@willowhouseweddings.test">dana@willowhouseweddings.test</a></p></footer>
</body></html>`;

export const WILLOW_CONTACT_HTML = `<!doctype html><html lang="en"><head><title>Contact | Willow House</title></head><body>
<h1>Contact Willow House</h1>
<p>Write to Dana Whitfield, Owner, at <a href="mailto:dana@willowhouseweddings.test">dana@willowhouseweddings.test</a> or call (518) 555-0142. Tours run Thursday through Sunday; weddings book twelve to eighteen months ahead.</p>
<p>Willow House, 214 River Road, Hudson, NY 12534.</p>
</body></html>`;

export const PARKED_HTML = `<!doctype html><html><head><title>willowhouseweddings.test is for sale | HugeDomains</title></head><body>
<h1>This domain is for sale!</h1>
<p>Buy this domain at HugeDomains.com. Make an offer today and own a premium name.</p>
</body></html>`;

export const EMPTY_SHELL_HTML = `<!doctype html><html><head><title>Welcome</title></head><body><p>Hello. More soon.</p></body></html>`;

export const NO_WEDDINGS_HTML = `<!doctype html><html lang="en"><head><title>Riverside Family Dentistry | Hudson, NY</title></head><body>
<h1>Riverside Family Dentistry</h1>
<img src="/images/office.jpg" alt="Our office" width="1200" height="800" />
<p>Gentle, modern dental care for the whole family in Hudson. We offer cleanings, fillings, crowns, whitening, and emergency appointments the same day whenever we can. New patients are always welcome, and we accept most insurance plans.</p>
<p>Our team has served the Hudson Valley for twenty years. Call the office to schedule a visit, ask about financing, or request your records. Parking is free behind the building and the office is wheelchair accessible.</p>
<footer><p>Riverside Family Dentistry · 88 Warren Street, Hudson, NY 12534 · (518) 555-0199</p></footer>
</body></html>`;

export const CANADA_HTML = `<!doctype html><html lang="en"><head><title>Maple Hall Weddings</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"EventVenue","name":"Maple Hall","telephone":"+1 416-555-0133","address":{"@type":"PostalAddress","streetAddress":"12 Queen Street West","addressLocality":"Toronto","addressRegion":"ON","postalCode":"M5V 2T6","addressCountry":"CA"}}</script>
</head><body>
<h1>Weddings at Maple Hall</h1>
<p>A heritage hall in downtown Toronto for weddings, ceremonies and receptions of up to 220 guests. Couples love the original tin ceilings and the rooftop for cocktails.</p>
<img src="/images/hall.jpg" alt="The Hall" width="1400" height="900" />
<footer><p>Maple Hall · 12 Queen Street West, Toronto, ON M5V 2T6 · (416) 555-0133</p></footer>
</body></html>`;

/* ————— RDAP / CDX / DNS / TLS / Places ————— */

export const RDAP_URL_OLD = "https://rdap.org/domain/willowhouseweddings.test";

export const RDAP_OLD = {
  objectClassName: "domain",
  ldhName: "willowhouseweddings.test",
  events: [
    { eventAction: "registration", eventDate: "2014-03-02T15:04:05Z" },
    { eventAction: "expiration", eventDate: "2027-03-02T15:04:05Z" },
  ],
  entities: [
    {
      objectClassName: "entity",
      roles: ["registrar"],
      vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "GoDaddy.com, LLC"]]],
    },
  ],
};

export const RDAP_FRESH = {
  objectClassName: "domain",
  ldhName: "freshvenue.test",
  events: [{ eventAction: "registration", eventDate: new Date(NOW.getTime() - 40 * DAY_MS).toISOString() }],
  entities: [{ objectClassName: "entity", roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Namecheap, Inc."]]] }],
};

export const CDX_URL_OLD =
  "https://web.archive.org/cdx/search/cdx?url=willowhouseweddings.test&output=json&fl=timestamp&limit=1";
export const CDX_OLD = [["timestamp"], ["20150611080000"]];
export const CDX_EMPTY = [["timestamp"]];

export const DNS_WORKSPACE: DnsInfo = { mx: ["aspmx.l.google.com", "alt1.aspmx.l.google.com"], spf: true, dmarc: true, error: null };
export const DNS_NONE: DnsInfo = { mx: [], spf: false, dmarc: false, error: null };
export const DNS_GODADDY_NO_AUTH: DnsInfo = { mx: ["mailstore1.secureserver.net", "smtp.secureserver.net"], spf: false, dmarc: false, error: null };
export const DNS_GMAIL: DnsInfo = { mx: ["gmail-smtp-in.l.google.com"], spf: true, dmarc: true, error: null };

export const TLS_OK: TlsInfo = {
  ok: true,
  issuer: "Let's Encrypt",
  validFrom: new Date(NOW.getTime() - 30 * DAY_MS),
  validTo: new Date(NOW.getTime() + 60 * DAY_MS),
  error: null,
  servername: "www.willowhouseweddings.test",
};
export const TLS_EXPIRED: TlsInfo = {
  ...TLS_OK,
  ok: false,
  validFrom: new Date(NOW.getTime() - 120 * DAY_MS),
  validTo: new Date(NOW.getTime() - 5 * DAY_MS),
};

export const PLACES_MATCH = {
  places: [
    {
      id: "ChIJwillowhouse123",
      displayName: { text: "Willow House", languageCode: "en" },
      formattedAddress: "214 River Rd, Hudson, NY 12534, USA",
      websiteUri: "https://www.willowhouseweddings.test/",
      nationalPhoneNumber: "(518) 555-0142",
      rating: 4.8,
      userRatingCount: 143,
      businessStatus: "OPERATIONAL",
      types: ["wedding_venue", "event_venue"],
    },
  ],
};
export const PLACES_CLOSED = {
  places: [{ ...PLACES_MATCH.places[0]!, businessStatus: "CLOSED_PERMANENTLY" }],
};
export const PLACES_NONE = { places: [] };

/* ————— Builders ————— */

export function siteFromPages(
  pages: Array<{ url: string; html: string }>,
  overrides: Partial<FetchedSite> = {},
): FetchedSite {
  const first = pages[0];
  return {
    requestedUrl: first?.url ?? WILLOW_URL,
    finalUrl: first?.url ?? WILLOW_URL,
    status: 200,
    contentType: "text/html; charset=utf-8",
    pages: pages.map((page) => ({ url: page.url, html: page.html, text: stripTags(page.html) })),
    error: null,
    ...overrides,
  };
}

export const WILLOW_SITE: FetchedSite = siteFromPages([
  { url: WILLOW_URL, html: WILLOW_HOME_HTML },
  { url: WILLOW_CONTACT_URL, html: WILLOW_CONTACT_HTML },
]);

export const WILLOW_PROSPECT = {
  id: 1,
  name: "Willow House",
  email: WILLOW_EMAIL,
  phone: WILLOW_PHONE,
  website: WILLOW_URL,
  region: "Hudson, NY",
  contactName: "Dana Whitfield",
};

export interface FixtureDepOverrides extends Partial<VettingDeps> {
  /** What fetchJson answers for the Places endpoint (default: PLACES_MATCH). */
  places?: unknown;
}

/** VettingDeps that answer from the fixtures above; override any single dependency. */
export function makeDeps(overrides: FixtureDepOverrides = {}): VettingDeps {
  const { places, ...rest } = overrides;
  const deps: VettingDeps = {
    fetchSite: async () => WILLOW_SITE,
    fetchJson: async (url) => {
      if (url === PLACES_SEARCH_URL) return { status: 200, json: places ?? PLACES_MATCH };
      if (url.startsWith("https://rdap.org/")) return { status: 200, json: RDAP_OLD };
      if (url.startsWith("https://web.archive.org/")) return { status: 200, json: CDX_OLD };
      return { status: 404, json: null };
    },
    resolveDns: async () => DNS_WORKSPACE,
    probeTls: async () => TLS_OK,
    rdap: async () => parseRdap(RDAP_OLD, RDAP_URL_OLD),
    wayback: async () => parseCdx(CDX_OLD, CDX_URL_OLD),
    now: () => NOW,
    ...rest,
  };
  return deps;
}

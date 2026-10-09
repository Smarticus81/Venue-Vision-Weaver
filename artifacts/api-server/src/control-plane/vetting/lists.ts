/**
 * Static lists the vetting checks consult (vetting.md 1.2). Kept short and
 * commented on purpose: these are curated signals, not exhaustive datasets.
 * Every entry here is a hint the scorer weighs; none of them alone decides a
 * verdict except the disposable-mail and parking signatures (hard fails).
 */

/** Throwaway mailbox providers. A prospect using one is not a business contact. */
export const DISPOSABLE_DOMAINS: string[] = [
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "dispostable.com",
  "getnada.com",
  "maildrop.cc",
  "throwawaymail.com",
  "tempmail.net",
  "fakeinbox.com",
  "mohmal.com",
  "mintemail.com",
  "tempr.email",
  "emailondeck.com",
  "33mail.com",
  "spamgourmet.com",
  "mailnesia.com",
];

export const DISPOSABLE_PATTERNS =
  /(^|\.)(tempmail|temp-mail|10minute|guerrilla|mailinator|throwaway|trashmail|yopmail|dispostable|getnada|maildrop)\./i;

/** Consumer mail providers: fine for a small venue, but they prove nothing about the business. */
export const FREE_MAIL_DOMAINS: string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "mail.com",
  "gmx.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
];

/** Local parts that address a function, not a person. Normal for venues; lower reply rate. */
export const ROLE_LOCAL_PARTS: string[] = [
  "info",
  "events",
  "event",
  "weddings",
  "wedding",
  "sales",
  "hello",
  "hi",
  "hey",
  "bookings",
  "booking",
  "contact",
  "contactus",
  "inquiries",
  "inquiry",
  "inquire",
  "enquiries",
  "enquiry",
  "admin",
  "office",
  "team",
  "reservations",
  "catering",
  "venue",
  "rentals",
  "rental",
  "frontdesk",
  "concierge",
  "mail",
  "email",
  "general",
  "support",
  "marketing",
  "press",
  "media",
  "welcome",
  "stay",
  "host",
  "hospitality",
];

/**
 * Words that mean a "contact name" is really a department or a title, so the
 * greeting must fall back to "Hi there,". Used by the copywriter and as a
 * no-human vetting signal.
 */
export const ROLE_NAME_WORDS: string[] = [
  ...ROLE_LOCAL_PARTS,
  "manager",
  "owner",
  "owners",
  "director",
  "coordinator",
  "staff",
  "front",
  "desk",
  "department",
  "dept",
  "reception",
  "guest",
  "services",
  "service",
  "sales",
  "planning",
  "planner",
  "weddingteam",
  "eventsteam",
];

/** Parking / for-sale / default-server pages. Any hit is a hard fail. */
export const PARKING_SIGNATURES: RegExp[] = [
  /domain (is|may be) for sale/i,
  /buy this domain/i,
  /parked free,? courtesy of/i,
  /sedoparking|sedo\.com\/search/i,
  /hugedomains\.com/i,
  /afternic\.com|dan\.com\/buy-domain/i,
  /this web ?page is parked/i,
  /godaddy\.com\/domain(s|search)/i,
  /\bparking page\b/i,
  /^\s*welcome to nginx!?\s*$/im,
  /apache2? (ubuntu|debian) default page/i,
  /index of \//i,
  /account (has been )?suspended/i,
  /site not found/i,
];

/** Only counts as parked when the page has almost no other words. */
export const COMING_SOON = /website coming soon|under construction/i;

export interface MxProviderRule {
  pattern: RegExp;
  provider: string;
  freeMail?: boolean;
}

/** Mail exchanger hostnames -> provider label. Order matters (first match wins). */
export const MX_PROVIDERS: MxProviderRule[] = [
  { pattern: /(^|\.)google(mail)?\.com$/, provider: "google_workspace" },
  { pattern: /\.outlook\.com$|\.protection\.outlook\.com$/, provider: "microsoft_365" },
  { pattern: /secureserver\.net$/, provider: "godaddy" },
  { pattern: /zoho(mail)?\.(com|eu|in)$/, provider: "zoho" },
  { pattern: /pphosted\.com$/, provider: "proofpoint" },
  { pattern: /mimecast\.com$/, provider: "mimecast" },
  { pattern: /emailsrvr\.com$/, provider: "rackspace" },
  { pattern: /yahoodns\.net$/, provider: "yahoo", freeMail: true },
  { pattern: /icloud\.com$/, provider: "icloud", freeMail: true },
  { pattern: /protonmail\.ch$/, provider: "proton", freeMail: true },
  { pattern: /mx\.cloudflare\.net$/, provider: "cloudflare_routing" },
  { pattern: /ionos\.(com|de)$|1and1\.com$/, provider: "ionos" },
  { pattern: /squarespace\.com$/, provider: "squarespace" },
  { pattern: /bluehost\.com$|hostgator\.com$|hostmonster\.com$/, provider: "shared_hosting" },
];

/** Operator-readable names for the MX providers above (used in summaries). */
export const MX_PROVIDER_LABELS: Record<string, string> = {
  google_workspace: "Workspace mail",
  microsoft_365: "Microsoft 365 mail",
  godaddy: "GoDaddy mail",
  zoho: "Zoho mail",
  proofpoint: "Proofpoint-filtered mail",
  mimecast: "Mimecast-filtered mail",
  rackspace: "Rackspace mail",
  yahoo: "free-mail address",
  icloud: "free-mail address",
  proton: "free-mail address",
  cloudflare_routing: "Cloudflare-routed mail",
  ionos: "IONOS mail",
  squarespace: "Squarespace mail",
  shared_hosting: "shared-hosting mail",
  other: "business mail",
};

export interface MarketplaceRule {
  host: RegExp;
  label: string;
}

/** Wedding marketplaces a real venue links to or carries a badge from. */
export const MARKETPLACE_HOSTS: MarketplaceRule[] = [
  { host: /(^|\.)theknot\.com$/i, label: "The Knot" },
  { host: /(^|\.)weddingwire\.com$/i, label: "WeddingWire" },
  { host: /(^|\.)zola\.com$/i, label: "Zola" },
  { host: /(^|\.)herecomestheguide\.com$/i, label: "Here Comes the Guide" },
  { host: /(^|\.)(wedding-spot|weddingspot)\.com$/i, label: "Wedding Spot" },
  { host: /(^|\.)eventective\.com$/i, label: "Eventective" },
  { host: /(^|\.)peerspace\.com$/i, label: "Peerspace" },
  { host: /(^|\.)weddingmapper\.com$/i, label: "Wedding Mapper" },
  { host: /(^|\.)junebugweddings\.com$/i, label: "Junebug" },
  { host: /(^|\.)stylemepretty\.com$/i, label: "Style Me Pretty" },
];

export interface SocialRule {
  host: RegExp;
  /** Lowercase network key, e.g. "instagram" (data.handles uses "instagram:handle"). */
  label: string;
  handleFrom: (url: URL) => string | null;
}

const NON_HANDLE_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "share",
  "sharer",
  "sharer.php",
  "hashtag",
  "explore",
  "watch",
  "pages",
  "intent",
  "home",
  "profile.php",
  "channel",
  "c",
  "user",
  "embed",
  "pin",
  "search",
]);

function firstPathHandle(url: URL): string | null {
  const segment = url.pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  const handle = decodeURIComponent(segment).replace(/^@/, "").trim();
  if (!handle || NON_HANDLE_SEGMENTS.has(handle.toLowerCase())) return null;
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(handle)) return null;
  return handle.toLowerCase();
}

export const SOCIAL_HOSTS: SocialRule[] = [
  { host: /(^|\.)instagram\.com$/i, label: "instagram", handleFrom: firstPathHandle },
  { host: /(^|\.)facebook\.com$/i, label: "facebook", handleFrom: firstPathHandle },
  { host: /(^|\.)tiktok\.com$/i, label: "tiktok", handleFrom: firstPathHandle },
  { host: /(^|\.)pinterest\.com$/i, label: "pinterest", handleFrom: firstPathHandle },
  { host: /(^|\.)youtube\.com$/i, label: "youtube", handleFrom: firstPathHandle },
  { host: /(^|\.)vimeo\.com$/i, label: "vimeo", handleFrom: firstPathHandle },
];

/** Global flag: always count with String.prototype.match, never .test() (stateful lastIndex). */
export const WEDDING_WORDS = /\b(wedding|weddings|ceremony|ceremonies|reception|bride|groom|couples?|elopement|rehearsal dinner)\b/gi;

export const OWNER_TITLE_RE =
  /\b(owner|co-owner|proprietor|founder|co-founder|general manager|venue manager|events? (manager|director|coordinator)|director of (events|sales)|sales manager|catering manager|innkeeper)\b/i;

/** ", ON" / ", BC" style province codes in a free-text region. */
export const CANADA_PROVINCES = /,\s*(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/;
/** Canadian postal code (letter-digit-letter digit-letter-digit). */
export const CANADA_POSTAL = /\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/;

/** Normalize a country as written on a site or in JSON-LD to ISO-2 where we can. */
export function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const lower = value.toLowerCase().replace(/\./g, "");
  const named: Record<string, string> = {
    canada: "CA",
    can: "CA",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
    us: "US",
    "united kingdom": "GB",
    uk: "GB",
    "great britain": "GB",
    australia: "AU",
    ireland: "IE",
    "new zealand": "NZ",
    mexico: "MX",
  };
  if (named[lower]) return named[lower]!;
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return null;
}

import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const readiness = await import("./databaseReadiness.js");
const envValidation = await import("./envValidation.js");
const operatorAuth = await import("../control-plane/operatorAuth.js");
const shell = await import("./noscriptShell.js");
const loggerModule = await import("./logger.js");
const grok = await import("../control-plane/grok.js");
const uploadToken = await import("./uploadToken.js");
const trustProxy = await import("./trustProxy.js");
const httpSecurity = await import("./httpSecurity.js");
const cleanupConfig = await import("./sessionCleanupConfig.js");
const health = await import("../routes/health.js");

type Introspection = import("./databaseReadiness.js").SchemaIntrospection;

/* ————— Fixture: a database that satisfies the whole contract ————— */

function completeIntrospection(): Introspection {
  const tables = readiness.REQUIRED_DATABASE_TABLES.map((table) => ({ table_name: table }));
  const notNull = new Set<string>();
  for (const [table, columns] of Object.entries(readiness.REQUIRED_DATABASE_NOT_NULL_COLUMNS)) {
    for (const column of columns) notNull.add(`${table}.${column}`);
  }
  const columns = Object.entries(readiness.REQUIRED_DATABASE_COLUMNS).flatMap(([table, cols]) =>
    cols.map((column) => ({
      table_name: table,
      column_name: column,
      is_nullable: (notNull.has(`${table}.${column}`) ? "NO" : "YES") as "YES" | "NO",
    })),
  );
  const indexes = readiness.REQUIRED_DATABASE_INDEXES.map((required, index) => ({
    tablename: required.table,
    indexname: "name" in required ? required.name : `fixture_index_${index}`,
    indexdef: `CREATE ${required.requiredFragments.join(" ")} INDEX`.replace(
      /^CREATE unique/,
      "CREATE UNIQUE",
    ),
  }));
  return { tables, columns, indexes };
}

test("a database matching the contract has no readiness findings", () => {
  assert.deepEqual(readiness.evaluateRequiredDatabaseSchema(completeIntrospection()), []);
});

test("missing organizations table and columns degrade readiness", () => {
  const fixture = completeIntrospection();
  fixture.tables = fixture.tables.filter((row) => row.table_name !== "organizations");
  fixture.columns = fixture.columns.filter((row) => row.table_name !== "organizations");
  fixture.indexes = fixture.indexes.filter((row) => row.tablename !== "organizations");
  const findings = readiness.evaluateRequiredDatabaseSchema(fixture);
  assert.ok(findings.includes("table:organizations"));
  assert.ok(findings.includes("column:organizations.clerk_org_id"));
  assert.ok(findings.includes("index:organizations.clerk_org_id.unique"));
});

test("retired owner_* tables are not part of the contract", () => {
  const fixture = completeIntrospection();
  // A database that dropped the legacy tables (or never had them) is fine.
  assert.ok(!readiness.REQUIRED_DATABASE_TABLES.some((table) => table.startsWith("owner_")));
  assert.deepEqual(readiness.evaluateRequiredDatabaseSchema(fixture), []);
  // And one that still has them is equally fine: extra tables never fail readiness.
  fixture.tables.push({ table_name: "owner_sessions" }, { table_name: "owner_login_tokens" });
  assert.deepEqual(readiness.evaluateRequiredDatabaseSchema(fixture), []);
});

test("control-plane tables, organization_id columns and funnel tables are required", () => {
  const tables = new Set<string>(readiness.REQUIRED_DATABASE_TABLES);
  for (const table of [
    "organizations",
    "control_agents",
    "agent_runs",
    "agent_actions",
    "control_prospects",
    "control_outreach_emails",
    "control_email_suppressions",
    "gallery_events",
    "funnel_events",
    "render_attempts",
  ]) {
    assert.ok(tables.has(table), `${table} must be required`);
  }
  assert.ok(readiness.REQUIRED_DATABASE_COLUMNS.venues.includes("organization_id"));
  assert.ok(readiness.REQUIRED_DATABASE_COLUMNS.credit_transactions.includes("organization_id"));

  const fixture = completeIntrospection();
  fixture.columns = fixture.columns.filter(
    (row) => !(row.table_name === "venues" && row.column_name === "organization_id"),
  );
  assert.ok(readiness.evaluateRequiredDatabaseSchema(fixture).includes("column:venues.organization_id"));
});

test("a required NOT NULL column that is nullable is reported", () => {
  const fixture = completeIntrospection();
  for (const row of fixture.columns) {
    if (row.table_name === "couple_sessions" && row.column_name === "share_token") row.is_nullable = "YES";
  }
  assert.ok(readiness.evaluateRequiredDatabaseSchema(fixture).includes("not-null:couple_sessions.share_token"));
});

test("row-level security evaluation lists public tables with RLS off", () => {
  assert.deepEqual(
    readiness.evaluateRowLevelSecurity([
      { tablename: "venues", rowsecurity: true },
      { tablename: "organizations", rowsecurity: false },
      { tablename: "agent_runs", rowsecurity: "f" },
      { tablename: "couple_sessions", rowsecurity: "t" },
    ]),
    ["agent_runs", "organizations"],
  );
  assert.deepEqual(readiness.evaluateRowLevelSecurity([]), []);
});

/* ————— Readiness detail gate ————— */

test("readiness detail token must match READINESS_DETAIL_TOKEN in constant time", () => {
  const env = { READINESS_DETAIL_TOKEN: "a-long-enough-detail-token-123" } as NodeJS.ProcessEnv;
  assert.equal(health.readinessTokenMatches("a-long-enough-detail-token-123", env), true);
  assert.equal(health.readinessTokenMatches(["a-long-enough-detail-token-123"], env), true);
  assert.equal(health.readinessTokenMatches("a-long-enough-detail-token-124", env), false);
  assert.equal(health.readinessTokenMatches(undefined, env), false);
  assert.equal(health.readinessTokenMatches("short", { READINESS_DETAIL_TOKEN: "short" } as NodeJS.ProcessEnv), false);
  assert.equal(health.readinessTokenMatches("anything", {} as NodeJS.ProcessEnv), false);
});

test("auth readiness degrades without Clerk keys", () => {
  const saved = {
    secret: process.env.CLERK_SECRET_KEY,
    pk: process.env.CLERK_PUBLISHABLE_KEY,
    vitePk: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  };
  try {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
    const result = health.authReadiness();
    assert.equal(result.status, "degraded");
    assert.ok(result.reasons[0]?.includes("CLERK_SECRET_KEY"));

    process.env.CLERK_SECRET_KEY = "sk_test_1234567890abcdef";
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_1234567890abcdef";
    assert.equal(health.authReadiness().status, "ok");
  } finally {
    if (saved.secret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = saved.secret;
    if (saved.pk === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
    else process.env.CLERK_PUBLISHABLE_KEY = saved.pk;
    if (saved.vitePk === undefined) delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
    else process.env.VITE_CLERK_PUBLISHABLE_KEY = saved.vitePk;
  }
});

/* ————— Production env validation ————— */

const productionEnv = {
  NODE_ENV: "production",
  PORT: "5000",
  DATABASE_URL: "postgresql://user:pass@aws-0-us.pooler.supabase.com:5432/postgres?sslmode=require",
  APP_BASE_URL: "https://dreemer.examplevenue.com",
  UPLOAD_TOKEN_SECRET: "long-upload-token-secret",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_live_key_123",
  CLERK_SECRET_KEY: "sk_live_1234567890abcdef",
  CLERK_PUBLISHABLE_KEY: "pk_live_1234567890abcdef",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_1234567890abcdef",
  CONTROL_PLANE_OPERATOR_EMAILS: "ops@examplevenue.com, founder@examplevenue.com",
  STRIPE_SECRET_KEY: "sk_live_1234567890abcdef",
  STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdef",
  STRIPE_PRICE_STARTER_MONTHLY: "price_123starter",
  STRIPE_PRICE_GROWTH_MONTHLY: "price_123growth",
  STRIPE_PRICE_CREDIT_PACK_10: "price_123pack10",
  RESEND_API_KEY: "re_live_real",
  EMAIL_FROM: "Dreemer <noreply@examplevenue.com>",
  OPENAI_API_KEY: "sk-proj-production-like-key-123",
  GOOGLE_AI_API_KEY: "AIzaProductionLikeKey123",
  IMAGE_MODEL: "gpt-image-2.5-sunburst",
  IMAGE_FALLBACK_MODELS: "gpt-image-2.5-flare,gemini-3-pro-image",
  OPENAI_IMAGE_QUALITY: "high",
  GEMINI_QUALITY_MODEL: "gemini-2.5-pro",
  GEMINI_IMAGE_SIZE: "2K",
  GALLERY_FRAME_ATTEMPTS: "4",
  GALLERY_QUALITY_GATE: "on",
  GENERATED_IMAGE_MIN_EDGE_PX: "1024",
  GENERATED_IMAGE_MIN_CONTRAST: "8",
  GENERATED_IMAGE_MIN_SHARPNESS: "6",
};

test("a complete production environment validates", () => {
  assert.deepEqual(envValidation.validateProductionEnvironment(productionEnv), []);
});

test("production requires Clerk keys and the operator allowlist", () => {
  const clerkless = envValidation.validateProductionEnvironment({
    ...productionEnv,
    CLERK_SECRET_KEY: "",
    CLERK_PUBLISHABLE_KEY: "",
    CLERK_WEBHOOK_SIGNING_SECRET: "",
  });
  assert.ok(clerkless.some((error) => error.startsWith("CLERK_SECRET_KEY")));
  assert.ok(clerkless.some((error) => error.startsWith("CLERK_PUBLISHABLE_KEY")));
  assert.ok(clerkless.some((error) => error.startsWith("CLERK_WEBHOOK_SIGNING_SECRET")));

  const noOperators = envValidation.validateProductionEnvironment({
    ...productionEnv,
    CONTROL_PLANE_OPERATOR_EMAILS: "",
  });
  assert.ok(noOperators.some((error) => error.startsWith("CONTROL_PLANE_OPERATOR_EMAILS")));

  const badOperators = envValidation.validateProductionEnvironment({
    ...productionEnv,
    CONTROL_PLANE_OPERATOR_EMAILS: "ops@examplevenue.com, not-an-email",
  });
  assert.ok(badOperators.some((error) => error.includes("invalid: not-an-email")));

  // The deploy template's defaults must not pass as real configuration.
  const templateDefaults = envValidation.validateProductionEnvironment({
    ...productionEnv,
    CONTROL_PLANE_OPERATOR_EMAILS: "founder@yourdomain.com",
    EMAIL_FROM: "Dreemer <noreply@yourdomain.com>",
  });
  assert.ok(templateDefaults.some((error) => error.startsWith("CONTROL_PLANE_OPERATOR_EMAILS still holds a placeholder")));
  assert.ok(templateDefaults.some((error) => error.startsWith("EMAIL_FROM still holds a placeholder")));
  assert.equal(envValidation.isPlaceholderEmail("ops@yourvenue.com"), false, "a real domain that starts with 'your' is fine");

  // VITE_CLERK_PUBLISHABLE_KEY alone satisfies the publishable-key requirement.
  assert.deepEqual(
    envValidation.validateProductionEnvironment({
      ...productionEnv,
      CLERK_PUBLISHABLE_KEY: "",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_live_1234567890abcdef",
    }),
    [],
  );
});

test("RESEND_WEBHOOK_SECRET is required once the control plane can send", () => {
  const errors = envValidation.validateProductionEnvironment({
    ...productionEnv,
    XAI_API_KEY: "xai-production-key",
  });
  assert.ok(errors.some((error) => error.startsWith("RESEND_WEBHOOK_SECRET")));
  assert.deepEqual(
    envValidation.validateProductionEnvironment({
      ...productionEnv,
      XAI_API_KEY: "xai-production-key",
      RESEND_WEBHOOK_SECRET: "whsec_resendsecret",
    }),
    [],
  );
});

test("production warnings flag host mismatch and dev-open control plane without failing boot", () => {
  const warnings = envValidation.productionEnvironmentWarnings({
    ...productionEnv,
    RAILWAY_PUBLIC_DOMAIN: "dreemer.up.railway.app",
    CONTROL_PLANE_DEV_OPEN: "true",
  });
  assert.equal(warnings.length, 2);
  assert.ok(warnings[0].includes("dreemer.examplevenue.com"));
  assert.ok(warnings[1].includes("CONTROL_PLANE_DEV_OPEN"));
  assert.deepEqual(envValidation.productionEnvironmentWarnings({ ...productionEnv, RAILWAY_PUBLIC_DOMAIN: "dreemer.examplevenue.com" }), []);
  assert.deepEqual(envValidation.productionEnvironmentWarnings({ NODE_ENV: "development" }), []);
});

test("image model chain predicate is shared and strict", () => {
  assert.equal(
    envValidation.isProductionImageModelChain(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gemini-3-pro-image"]),
    true,
  );
  assert.equal(envValidation.isProductionImageModelChain(["gpt-image-2.5-flare"]), false);
  assert.equal(envValidation.isProductionImageModelChain(["gpt-image-2.5-sunburst", "gemini-2.5-flash-image"]), false);
});

/* ————— Operator gate ————— */

test("operator access fails closed when the allowlist is empty", () => {
  assert.deepEqual(operatorAuth.operatorAccessDecision("owner@venue.com", {} as NodeJS.ProcessEnv), {
    kind: "not_configured",
  });
  assert.deepEqual(
    operatorAuth.operatorAccessDecision("owner@venue.com", { NODE_ENV: "development" } as NodeJS.ProcessEnv),
    { kind: "not_configured" },
  );
  assert.deepEqual(
    operatorAuth.operatorAccessDecision("owner@venue.com", {
      NODE_ENV: "development",
      CONTROL_PLANE_DEV_OPEN: "true",
    } as NodeJS.ProcessEnv),
    { kind: "allowed", reason: "dev_open" },
  );
  assert.deepEqual(
    operatorAuth.operatorAccessDecision("owner@venue.com", {
      NODE_ENV: "production",
      CONTROL_PLANE_DEV_OPEN: "true",
    } as NodeJS.ProcessEnv),
    { kind: "not_configured" },
  );
});

test("operator allowlist is case-insensitive and exact", () => {
  const env = { CONTROL_PLANE_OPERATOR_EMAILS: "Ops@Example.com, second@example.com" } as NodeJS.ProcessEnv;
  assert.deepEqual(operatorAuth.operatorAccessDecision("ops@example.com", env), {
    kind: "allowed",
    reason: "allowlist",
  });
  assert.deepEqual(operatorAuth.operatorAccessDecision("owner@venue.com", env), { kind: "forbidden" });
});

test("operator email lookups are cached and failures are not", async () => {
  operatorAuth.resetOperatorEmailCache();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return "ops@example.com";
  };
  assert.deepEqual(await operatorAuth.resolveOperatorEmail("user_1", { fetcher, now: 1_000 }), {
    ok: true,
    email: "ops@example.com",
  });
  assert.deepEqual(await operatorAuth.resolveOperatorEmail("user_1", { fetcher, now: 2_000 }), {
    ok: true,
    email: "ops@example.com",
  });
  assert.equal(calls, 1);
  // Past the TTL the lookup runs again.
  await operatorAuth.resolveOperatorEmail("user_1", { fetcher, now: 1_000 + 6 * 60_000 });
  assert.equal(calls, 2);

  const failing = async () => {
    throw new Error("clerk unavailable");
  };
  const failed = await operatorAuth.resolveOperatorEmail("user_2", { fetcher: failing, now: 1_000 });
  assert.equal(failed.ok, false);
  const recovered = await operatorAuth.resolveOperatorEmail("user_2", { fetcher, now: 1_000 });
  assert.deepEqual(recovered, { ok: true, email: "ops@example.com" });
  operatorAuth.resetOperatorEmailCache();
});

/* ————— SPA shell ————— */

const publicConfig = {
  pricing: {
    currency: "USD",
    label: "Launch prices",
    starterMonthly: 129,
    growthMonthly: 279,
    creditPack: 59,
    starterCredits: 25,
    growthCredits: 100,
    creditPackCredits: 10,
  },
  trial: { credits: 5, days: 14 },
  founding: { slotsLeft: 10, slotsTotal: 10 },
  proof: { mode: "partner" as const },
  contactEmail: "hello@example.com",
  billingConfigured: true,
  retentionDays: 30,
};

const shellHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>Dreemer - Turn tours into bookings</title>
<meta name="description" content="Default description" />
<meta name="robots" content="index, follow" />
<meta property="og:title" content="Dreemer" />
<meta property="og:image" content="/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="/og-image.png" />
<link rel="icon" href="/favicon.ico" /></head><body><div id="root"></div><script type="module" src="/x.js"></script></body></html>`;

test("noscript shell carries the pitch, the prices and a plain sign-up anchor", () => {
  const html = shell.renderNoscriptShell(publicConfig, "/");
  assert.ok(html.startsWith("<noscript>"));
  assert.ok(html.includes("<h1>Turn tours into bookings.</h1>"));
  assert.ok(html.includes("Starter $129 a month, 25 galleries"));
  assert.ok(html.includes("Growth $279 a month, 100 galleries"));
  assert.ok(html.includes("Credit pack $59, 10 galleries"));
  assert.ok(html.includes("Launch prices"));
  assert.ok(html.includes('href="/create-venue"'));
  assert.ok(html.includes("five galleries, no card"));
  assert.ok(html.includes('href="mailto:hello@example.com"'));
  assert.ok(html.includes("/dreemer-lockup-email.png"));
});

test("noscript shell omits the contact link without an address and switches copy on gallery paths", () => {
  const noContact = shell.renderNoscriptShell({ ...publicConfig, contactEmail: null }, "/pricing");
  assert.ok(!noContact.includes("mailto:"));
  const gallery = shell.renderNoscriptShell(publicConfig, "/v/abcdefghijklmnop");
  assert.ok(gallery.includes("This gallery needs JavaScript"));
  assert.ok(!gallery.includes("Starter $129"));
});

test("shell rendering injects head tags, flips robots and places noscript after the root div", () => {
  const html = shell.renderShellHtml({
    html: shellHtml,
    headTags: '<meta name="dreemer-public-config" content="{}" />',
    noindex: true,
    noscript: "<noscript>hi</noscript>",
  });
  assert.ok(html.includes('<head><meta name="dreemer-public-config" content="{}" />'));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.ok(!html.includes("index, follow"));
  assert.ok(html.includes('<div id="root"></div><noscript>hi</noscript>'));
  // Default shell meta is untouched when nothing replaces it.
  assert.equal((html.match(/og:title/g) ?? []).length, 1);
});

test("gallery Open Graph tags are absolute and replace the shell's defaults instead of duplicating them", () => {
  const tags = shell.galleryOpenGraphTags({
    title: "Ana & Luis at Ivy Hall · Dreemer",
    description: 'AI preview: Ana & Luis imagined at Ivy Hall, made with "Dreemer".',
    pageUrl: "https://dreemer.example.com/v/abcdefghijklmnop",
    imageUrl: "https://dreemer.example.com/api/storage/objects/uploads/x.jpg?shareToken=abcdefghijklmnop",
  });
  assert.ok(tags.includes('<meta property="og:url" content="https://dreemer.example.com/v/abcdefghijklmnop" />'));
  assert.ok(tags.includes('og:image" content="https://dreemer.example.com/api/storage/objects/uploads/x.jpg?shareToken=abcdefghijklmnop"'));
  assert.ok(tags.includes("&quot;Dreemer&quot;"));
  assert.ok(!tags.includes("og:image:width"));

  const withDimensions = shell.galleryOpenGraphTags({
    title: "t",
    description: "d",
    pageUrl: "https://dreemer.example.com/v/abcdefghijklmnop",
    imageUrl: "https://dreemer.example.com/og-image.png",
    imageWidth: 1200,
    imageHeight: 630,
  });
  assert.ok(withDimensions.includes('og:image:width" content="1200"'));

  const html = shell.renderShellHtml({ html: shellHtml, replaceMetaWith: tags, noindex: true });
  assert.equal((html.match(/og:title/g) ?? []).length, 1);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.ok(html.includes("Ana &amp; Luis at Ivy Hall"));
  assert.ok(!html.includes("Default description"));
  assert.ok(!html.includes('content="/og-image.png"'));
  assert.ok(html.includes('<link rel="icon" href="/favicon.ico" />'));
});

test("couple names containing $-patterns are inserted literally, never expanded by String.replace", () => {
  const tags = shell.galleryOpenGraphTags({
    title: "A $' B $` C $& D at Ivy Hall",
    description: "x",
    pageUrl: "https://dreemer.example.com/v/abc",
    imageUrl: "https://dreemer.example.com/og.png",
  });
  const html = shell.renderShellHtml({ html: shellHtml, replaceMetaWith: tags, noscript: "<p>$' and $`</p>" });
  assert.ok(html.includes("A $&#39; B $` C $&amp; D at Ivy Hall") || html.includes("A $' B $` C $& D"));
  assert.equal((html.match(/<head>/g) ?? []).length, 1, "no copy of the document spliced in");
  assert.equal((html.match(/<body>/g) ?? []).length, (shellHtml.match(/<body>/g) ?? []).length);
  assert.ok(html.includes("<p>$' and $`</p>"));
});

test("shell default preview images become absolute when no page-specific meta replaces them", () => {
  const html = shell.renderShellHtml({ html: shellHtml, assetBaseUrl: "https://dreemer.example.com/" });
  assert.ok(html.includes('<meta property="og:image" content="https://dreemer.example.com/og-image.png" />'));
  assert.ok(html.includes('<meta name="twitter:image" content="https://dreemer.example.com/og-image.png" />'));
  assert.ok(!html.includes('content="/og-image.png"'));
  // Other relative attributes (icons) are untouched, and width/height stay.
  assert.ok(html.includes('<link rel="icon" href="/favicon.ico" />'));
  assert.ok(html.includes('og:image:width" content="1200"'));
  // Page-specific tags win; nothing is rewritten twice.
  const replaced = shell.renderShellHtml({
    html: shellHtml,
    assetBaseUrl: "https://dreemer.example.com",
    replaceMetaWith: '<meta property="og:image" content="https://cdn.example.com/x.jpg" />',
  });
  assert.equal((replaced.match(/og:image"/g) ?? []).length, 1);
  assert.ok(replaced.includes("https://cdn.example.com/x.jpg"));
});

test("noindex applies to private paths only", () => {
  for (const path of ["/v/abc", "/preview/ivy-hall", "/dashboard", "/dashboard/ivy-hall", "/control", "/claim/tok"]) {
    assert.equal(shell.isNoindexPath(path), true, path);
  }
  for (const path of ["/", "/pricing", "/privacy", "/create-venue", "/login"]) {
    assert.equal(shell.isNoindexPath(path), false, path);
  }
});

/* ————— Log redaction ————— */

test("token path segments and query strings never reach the logs", () => {
  const redact = loggerModule.redactUrlForLog;
  assert.equal(redact("/v/Qm3xZ9kLp2VtR8sYwN4a?utm=x"), "/v/[redacted]");
  assert.equal(redact("/api/sessions/by-token/Qm3xZ9kLp2VtR8sYwN4a/events"), "/api/sessions/by-token/[redacted]/events");
  assert.equal(redact("/api/outreach/unsubscribe/abcdefgh12345678"), "/api/outreach/unsubscribe/[redacted]");
  assert.equal(redact("/claim/abcdefgh"), "/claim/[redacted]");
  assert.equal(redact("/api/storage/objects/uploads/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.jpg"), "/api/storage/objects/uploads/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.jpg");
  assert.equal(redact("/api/venues/ivy-hall"), "/api/venues/ivy-hall");
  assert.equal(redact(undefined), undefined);
  assert.match(loggerModule.fingerprintForLog("Someone@Example.com"), /^sha256:[0-9a-f]{12}$/);
  assert.equal(loggerModule.fingerprintForLog("a@b.c"), loggerModule.fingerprintForLog(" A@B.C "));
});

/* ————— Grok plumbing ————— */

test("tool results are truncated structurally, never mid-string", () => {
  const small = { rows: [1, 2, 3] };
  assert.equal(grok.truncateForModel(small), small);

  const rows = Array.from({ length: 2000 }, (_, index) => ({
    id: index,
    name: `Venue ${index}`,
    notes: "x".repeat(200),
  }));
  const compact = grok.truncateForModel({ rows, total: rows.length }) as {
    truncated: boolean;
    originalLength: number;
    result: { rows: unknown[]; total?: number };
  };
  assert.equal(compact.truncated, true);
  const serialized = JSON.stringify(compact);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(serialized.length < compact.originalLength);
  assert.ok(serialized.length < 40_000);
  assert.ok(Array.isArray(compact.result.rows));
  assert.ok(compact.result.rows.length < rows.length);
  const marker = compact.result.rows[compact.result.rows.length - 1];
  assert.match(String(marker), /more items/);

  const long = grok.truncateForModel({ text: "y".repeat(30_000) }) as { result: { text: string } };
  assert.match(long.result.text, /more chars\]$/);
});

test("Grok request errors classify provider trouble as transient", () => {
  assert.equal(new grok.GrokRequestError("x", { status: 429 }).transient, true);
  assert.equal(new grok.GrokRequestError("x", { status: 503 }).transient, true);
  assert.equal(new grok.GrokRequestError("x", { status: 0, timedOut: true }).transient, true);
  assert.equal(new grok.GrokRequestError("x", { status: 400 }).transient, false);
  assert.equal(grok.grokRequestTimeoutMs({} as NodeJS.ProcessEnv), 60_000);
  assert.equal(grok.grokRequestTimeoutMs({ GROK_TIMEOUT_MS: "1000" } as NodeJS.ProcessEnv), 5_000);
  assert.equal(grok.grokRequestTimeoutMs({ GROK_TIMEOUT_MS: "90000" } as NodeJS.ProcessEnv), 90_000);
});

test("agent run budget clamps to one to thirty minutes", () => {
  assert.equal(grok.agentRunBudgetMs({} as NodeJS.ProcessEnv), 8 * 60_000);
  assert.equal(grok.agentRunBudgetMs({ CONTROL_PLANE_RUN_BUDGET_MS: "1000" } as NodeJS.ProcessEnv), 60_000);
  assert.equal(grok.agentRunBudgetMs({ CONTROL_PLANE_RUN_BUDGET_MS: "99999999" } as NodeJS.ProcessEnv), 30 * 60_000);
  assert.equal(grok.agentRunBudgetMs({ CONTROL_PLANE_RUN_BUDGET_MS: "abc" } as NodeJS.ProcessEnv), 8 * 60_000);
});

test("agent loop stops at its wall-clock budget without executing further tools", async (t) => {
  const originalFetch = globalThis.fetch;
  const savedKey = process.env.XAI_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedKey;
  });
  process.env.XAI_API_KEY = "xai-test-key";

  // Every response asks for another tool call, so only the budget can end the run.
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    const payload = {
      id: `resp_${requests}`,
      output: [
        { type: "function_call", call_id: `call_${requests}`, name: "get_business_metrics", arguments: "{}" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  let executed = 0;
  const result = await grok.runAgentLoop({
    systemPrompt: "s",
    userMessage: "u",
    tools: [{ name: "get_business_metrics", description: "KPIs" }],
    budgetMs: 50,
    executeTool: async () => {
      executed += 1;
      // The first tool call outlives the budget; nothing after it may run.
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: true };
    },
  });

  assert.equal(requests, 1, `expected the loop to stop after the budget, made ${requests} requests`);
  assert.equal(executed, 1);
  assert.match(result.finalText, /time budget/);
  const lastResult = [...result.transcript].reverse().find((step) => step.type === "tool_result");
  assert.ok(lastResult);
});

/* ————— Upload tokens, proxy, TLS, cleanup knobs ————— */

test("couple upload tokens expose their expiry for intent TTLs", () => {
  const now = 1_700_000_000_000;
  const token = uploadToken.createCoupleUploadToken("ivy-hall", now);
  assert.equal(uploadToken.coupleUploadTokenExpiry(token, "ivy-hall", now), now + uploadToken.COUPLE_UPLOAD_TOKEN_TTL_MS);
  assert.equal(uploadToken.verifyCoupleUploadToken(token, "ivy-hall", now), true);
  assert.equal(uploadToken.coupleUploadTokenExpiry(token, "other-venue", now), null);
  assert.equal(uploadToken.coupleUploadTokenExpiry(token, "ivy-hall", now + uploadToken.COUPLE_UPLOAD_TOKEN_TTL_MS + 1), null);
  assert.equal(uploadToken.coupleUploadTokenExpiry(`${token}x`, "ivy-hall", now), null);
  assert.equal(uploadToken.coupleUploadTokenExpiry("garbage", "ivy-hall", now), null);
});

test("x-forwarded-for with trust proxy off is flagged once by the caller", () => {
  assert.equal(trustProxy.forwardedForIgnored({ "x-forwarded-for": "203.0.113.9" }, false), true);
  assert.equal(trustProxy.forwardedForIgnored({ "x-forwarded-for": "203.0.113.9" }, 1), false);
  assert.equal(trustProxy.forwardedForIgnored({}, false), false);
});

test("HSTS applies only to TLS traffic in production", () => {
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert.equal(httpSecurity.servedOverTls({ secure: true, headers: {} }, prod), true);
  assert.equal(httpSecurity.servedOverTls({ secure: false, headers: { "x-forwarded-proto": "https" } }, prod), true);
  assert.equal(httpSecurity.servedOverTls({ secure: false, headers: { "x-forwarded-proto": "http" } }, prod), false);
  assert.equal(httpSecurity.servedOverTls({ secure: true, headers: {} }, { NODE_ENV: "development" } as NodeJS.ProcessEnv), false);
});

function cspFor(env: Record<string, string | undefined>): string {
  const saved = { ...process.env };
  for (const key of ["CLERK_PUBLISHABLE_KEY", "VITE_CLERK_PUBLISHABLE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  const headers: Record<string, string> = {};
  try {
    httpSecurity.securityHeaders(
      { secure: false, headers: {} } as never,
      { setHeader: (name: string, value: string) => { headers[name] = value; } } as never,
      () => {},
    );
  } finally {
    process.env = saved;
  }
  return headers["Content-Security-Policy"] ?? "";
}

test("CSP allows the Turnstile widget whenever both Turnstile keys are set, even without Clerk", () => {
  const withTurnstile = cspFor({ TURNSTILE_SECRET_KEY: "0x4AAA-secret", TURNSTILE_SITE_KEY: "0x4AAA-site" });
  assert.match(withTurnstile, /script-src 'self'[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(withTurnstile, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  const without = cspFor({});
  assert.doesNotMatch(without, /challenges\.cloudflare\.com/);
  assert.doesNotMatch(without, /frame-src/);
  const siteKeyOnly = cspFor({ TURNSTILE_SITE_KEY: "0x4AAA-site" });
  assert.doesNotMatch(siteKeyOnly, /challenges\.cloudflare\.com/, "the widget only renders when the secret is set too");
});

test("upload-intent knobs clamp to safe ranges", () => {
  assert.equal(cleanupConfig.uploadIntentCleanupIntervalMinutes({} as NodeJS.ProcessEnv), 15);
  assert.equal(cleanupConfig.uploadIntentCleanupIntervalMinutes({ UPLOAD_INTENT_CLEANUP_INTERVAL_MINUTES: "0" } as NodeJS.ProcessEnv), 1);
  assert.equal(cleanupConfig.uploadIntentVenueDailyCap({} as NodeJS.ProcessEnv), 300);
  assert.equal(cleanupConfig.uploadIntentVenueDailyCap({ UPLOAD_INTENT_VENUE_DAILY_CAP: "999999" } as NodeJS.ProcessEnv), 5000);
  assert.equal(cleanupConfig.uploadIntentCoupleHourlyCap({ UPLOAD_INTENT_COUPLE_HOURLY_CAP: "abc" } as NodeJS.ProcessEnv), 60);
  assert.equal(cleanupConfig.uploadIntentCleanupBatchSize({ UPLOAD_INTENT_CLEANUP_BATCH_SIZE: "2" } as NodeJS.ProcessEnv), 10);
});

test("the operator allowlist is only ever matched against a verified Clerk address", () => {
  const verified = { status: "verified" };
  const unverified = { status: "unverified" };
  // Phone/username sign-up (no primary email) that added the operator's
  // address to its own profile without verifying it.
  assert.equal(
    operatorAuth.operatorEmailFromClerkUser({
      primaryEmailAddressId: null,
      emailAddresses: [{ id: "e1", emailAddress: "ops@example.com", verification: unverified }],
    }),
    null,
  );
  assert.equal(
    operatorAuth.operatorEmailFromClerkUser({
      primaryEmailAddressId: "e1",
      emailAddresses: [
        { id: "e1", emailAddress: "ops@example.com", verification: unverified },
        { id: "e2", emailAddress: "Me@Venue.com", verification: verified },
      ],
    }),
    "me@venue.com",
  );
  assert.equal(
    operatorAuth.operatorEmailFromClerkUser({
      primaryEmailAddressId: "e2",
      emailAddresses: [
        { id: "e1", emailAddress: "other@venue.com", verification: verified },
        { id: "e2", emailAddress: "ops@example.com", verification: verified },
      ],
    }),
    "ops@example.com",
  );
});

test("bootstrap.sql can pass readiness before the owner_* drop, and dedupes trial grantees before the unique index", async () => {
  const { readFile } = await import("node:fs/promises");
  const bootstrap = await readFile(new URL("../../../../supabase/bootstrap.sql", import.meta.url), "utf8");
  for (const table of ["owner_sessions", "owner_login_tokens", "owner_credentials"]) {
    assert.match(bootstrap, new RegExp(`ALTER TABLE IF EXISTS ${table} ENABLE ROW LEVEL SECURITY;`));
  }
  const dedupe = bootstrap.indexOf("SET trial_granted_by_clerk_user_id = NULL");
  const index = bootstrap.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS organizations_trial_grantee_unique");
  assert.ok(dedupe > 0 && index > dedupe, "the dedupe runs before the unique index");
  assert.match(bootstrap, /ADD COLUMN IF NOT EXISTS delivery_hold_reason TEXT/);
});

test("the runtime image carries the demo couple folder where sampleGallery looks for it", async () => {
  const { readFile } = await import("node:fs/promises");
  const dockerfile = await readFile(new URL("../../../../Dockerfile", import.meta.url), "utf8");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
  assert.match(runtime, /COPY --from=builder[^\n]*\/app\/lib\/brand\/assets\/demo-couple \.\/lib\/brand\/assets\/demo-couple/);
  const { demoCoupleDirCandidates } = await import("./sampleGallery.js");
  assert.ok(demoCoupleDirCandidates({}, "/app").includes("/app/lib/brand/assets/demo-couple"));
});

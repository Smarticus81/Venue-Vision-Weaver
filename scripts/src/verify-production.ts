import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type CheckStatus = "ok" | "fail";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const envValidationModule = (await import(
  new URL("../../artifacts/api-server/src/lib/envValidation.ts", import.meta.url).href
)) as {
  validateProductionEnvironment: (env: Record<string, string | undefined>) => string[];
};

const motionReelModule = (await import(
  new URL("../../artifacts/api-server/src/lib/motionReel.ts", import.meta.url).href
)) as {
  checkFfmpegAvailable: () => Promise<boolean>;
  ffmpegExecutable: () => string;
};

const { validateProductionEnvironment } = envValidationModule;
const { checkFfmpegAvailable, ffmpegExecutable } = motionReelModule;

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function ok(name: string, detail: string): CheckResult {
  return { name, status: "ok", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "fail", detail };
}

function repoPath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

function checkBuiltArtifacts(): CheckResult {
  const required = [
    "artifacts/api-server/dist/index.mjs",
    "artifacts/wedding-app/dist/public/index.html",
  ];
  const missing = required.filter((file) => !fs.existsSync(repoPath(file)));
  if (missing.length > 0) {
    return fail(
      "build artifacts",
      `Missing ${missing.join(", ")}. Run pnpm run build before deployment.`,
    );
  }
  return ok("build artifacts", "API server and web app production bundles exist.");
}

function checkProductionEnv(): CheckResult {
  const errors = validateProductionEnvironment({
    ...process.env,
    NODE_ENV: "production",
  });
  if (errors.length > 0) {
    return fail("production env", errors.map((error) => `- ${error}`).join("\n"));
  }
  return ok("production env", "Required production configuration is present and policy-compliant.");
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function numberAtLeast(value: unknown, min: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min;
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasValidReferenceFingerprints(value: unknown, min: number, max?: number): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length < min) return false;
  if (typeof max === "number" && value.length > max) return false;
  return value.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { file?: unknown }).file === "string" &&
      isSha256((entry as { sha256?: unknown }).sha256),
  );
}

function checkGalleryQaEvidence(): CheckResult {
  if (hasFlag("--skip-qa")) {
    return ok("gallery QA evidence", "Skipped by --skip-qa.");
  }

  const reportPath = repoPath(
    argValue("--qa-report") ?? path.join("qa-output", "live-gallery", "quality-report.json"),
  );
  const acceptancePath = repoPath(
    argValue("--qa-acceptance") ?? path.join(path.dirname(reportPath), "manual-acceptance.json"),
  );

  if (!fs.existsSync(reportPath)) {
    return fail(
      "gallery QA evidence",
      `Missing ${path.relative(process.cwd(), reportPath)}. Run pnpm run gallery:qa with real consented references, or pass --qa-report <path>.`,
    );
  }
  if (!fs.existsSync(acceptancePath)) {
    return fail(
      "gallery QA evidence",
      `Missing ${path.relative(process.cwd(), acceptancePath)}. After manual review, create it with {"accepted":true,"reviewedBy":"name","reviewedAt":"ISO date","notes":"..."}.`,
    );
  }

  try {
    const report = readJsonFile(reportPath) as {
      failed?: unknown;
      models?: { image?: unknown; qualityGate?: unknown };
      inputs?: {
        consentConfirmed?: unknown;
        couple?: unknown;
        venue?: unknown;
      };
      frames?: unknown[];
      reelPath?: unknown;
      summary?: {
        automatedPass?: unknown;
        frameCount?: unknown;
        reelReady?: unknown;
        minLikenessScore?: unknown;
        minPartnerScore?: unknown;
        minVenueScore?: unknown;
        minCompositionScore?: unknown;
        warnings?: unknown;
      };
    };
    const acceptance = readJsonFile(acceptancePath) as {
      accepted?: unknown;
      reviewedBy?: unknown;
      reviewedAt?: unknown;
    };

    const failures: string[] = [];
    if (report.failed) failures.push(`report failed: ${String(report.failed).slice(0, 160)}`);
    if (report.inputs?.consentConfirmed !== true) {
      failures.push("QA report does not confirm consented couple and venue references");
    }
    if (!hasValidReferenceFingerprints(report.inputs?.couple, 2, 3)) {
      failures.push("QA report is missing SHA-256 fingerprints for 2-3 couple references");
    }
    if (!hasValidReferenceFingerprints(report.inputs?.venue, 5)) {
      failures.push("QA report is missing SHA-256 fingerprints for at least 5 venue references");
    }
    if (report.summary?.automatedPass !== true) failures.push("summary.automatedPass is not true");
    if (report.summary?.frameCount !== 4 || report.frames?.length !== 4) {
      failures.push("report does not contain exactly four frames");
    }
    if (report.summary?.reelReady !== true || typeof report.reelPath !== "string") {
      failures.push("motion reel is missing");
    }
    if (report.models?.image !== "gemini-3-pro-image") {
      failures.push("primary image model is not gemini-3-pro-image");
    }
    if (report.models?.qualityGate !== "on") failures.push("quality gate was not enabled");
    if (!numberAtLeast(report.summary?.minLikenessScore, 0.82)) {
      failures.push("minimum likeness score is below 0.82");
    }
    if (!numberAtLeast(report.summary?.minPartnerScore, 0.78)) {
      failures.push("minimum per-partner likeness score is below 0.78");
    }
    if (!numberAtLeast(report.summary?.minVenueScore, 0.8)) {
      failures.push("minimum venue score is below 0.80");
    }
    if (!numberAtLeast(report.summary?.minCompositionScore, 0.74)) {
      failures.push("minimum composition score is below 0.74");
    }
    if (Array.isArray(report.summary?.warnings) && report.summary.warnings.length > 0) {
      failures.push(`warnings remain: ${report.summary.warnings.join("; ").slice(0, 240)}`);
    }
    if (acceptance.accepted !== true) failures.push("manual acceptance is not true");
    if (typeof acceptance.reviewedBy !== "string" || !acceptance.reviewedBy.trim()) {
      failures.push("manual acceptance is missing reviewedBy");
    }
    if (
      typeof acceptance.reviewedAt !== "string" ||
      Number.isNaN(Date.parse(acceptance.reviewedAt))
    ) {
      failures.push("manual acceptance is missing a valid reviewedAt ISO timestamp");
    }

    if (failures.length > 0) {
      return fail("gallery QA evidence", failures.map((failure) => `- ${failure}`).join("\n"));
    }

    return ok(
      "gallery QA evidence",
      `Automated gallery QA passed and manual review was accepted by ${acceptance.reviewedBy}.`,
    );
  } catch (err) {
    return fail(
      "gallery QA evidence",
      err instanceof Error ? err.message : "Could not parse gallery QA evidence.",
    );
  }
}

async function checkFfmpeg(): Promise<CheckResult> {
  const executable = ffmpegExecutable();
  if (await checkFfmpegAvailable()) {
    return ok("ffmpeg", `Executable available: ${executable}`);
  }

  const dockerfile = fs.existsSync(repoPath("Dockerfile"))
    ? fs.readFileSync(repoPath("Dockerfile"), "utf8")
    : "";
  const railwayToml = fs.existsSync(repoPath("railway.toml"))
    ? fs.readFileSync(repoPath("railway.toml"), "utf8")
    : "";
  const railwayUsesDockerfile =
    /\bbuilder\s*=\s*"DOCKERFILE"/i.test(railwayToml) &&
    /\bdockerfilePath\s*=\s*"Dockerfile"/i.test(railwayToml);
  const dockerfileInstallsFfmpeg =
    /apt-get install[\s\S]*\bffmpeg\b/i.test(dockerfile) ||
    /apk add[\s\S]*\bffmpeg\b/i.test(dockerfile);

  if (railwayUsesDockerfile && dockerfileInstallsFfmpeg) {
    return ok(
      "ffmpeg",
      `Local ${executable} was not executable, but Railway deploys the Dockerfile and the Dockerfile installs ffmpeg. The live --url readiness check still verifies runtime ffmpeg after deployment.`,
    );
  }

  return fail(
    "ffmpeg",
    `Could not execute ${executable}. Install ffmpeg, set FFMPEG_PATH, place the binary in artifacts/api-server/bin, or deploy with a Dockerfile that installs ffmpeg.`,
  );
}

async function checkSecuritySmoke(): Promise<CheckResult> {
  if (hasFlag("--skip-smoke")) {
    return ok("security smoke", "Skipped by --skip-smoke.");
  }

  const scriptPath = repoPath("scripts", "src", "security-smoke.ts");
  const tsxPath = repoPath("scripts", "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxPath, scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (code !== 0) {
    const detail = output.trim().split(/\r?\n/).slice(-20).join("\n") || `Exited with code ${code}`;
    return fail("security smoke", detail);
  }

  return ok("security smoke", "Gallery, auth, storage, billing, and source-contract smoke suite passed.");
}

async function checkDatabaseSchema(): Promise<CheckResult> {
  if (hasFlag("--skip-db")) {
    return ok("database schema", "Skipped by --skip-db.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    return fail("database schema", "DATABASE_URL is required to verify migrated production tables.");
  }

  try {
    const databaseReadinessModule = (await import(
      new URL("../../artifacts/api-server/src/lib/databaseReadiness.ts", import.meta.url).href
    )) as {
      missingRequiredDatabaseSchema: () => Promise<string[]>;
    };
    const { missingRequiredDatabaseSchema } = databaseReadinessModule;
    const missing = await missingRequiredDatabaseSchema();
    if (missing.length > 0) {
      return fail(
        "database schema",
        `Missing required schema items: ${missing.join(", ")}. Run pnpm --filter @workspace/db run push or apply supabase/bootstrap.sql.`,
      );
    }
    return ok("database schema", "All required production tables, columns, and indexes exist.");
  } catch (err) {
    return fail(
      "database schema",
      err instanceof Error ? err.message : "Could not verify database schema.",
    );
  }
}

function readinessUrl(base: string): string {
  const url = new URL(base);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/api/readyz";
  } else if (!url.pathname.endsWith("/readyz")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/readyz`;
  }
  return url.toString();
}

async function checkRemoteReadiness(baseUrl: string): Promise<CheckResult> {
  const url = readinessUrl(baseUrl);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    let body: { status?: string; checks?: Record<string, string> } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return fail("remote readiness", `${url} returned non-JSON response: ${text.slice(0, 300)}`);
    }

    const degraded = Object.entries(body.checks ?? {})
      .filter(([, status]) => status !== "ok")
      .map(([name, status]) => `${name}=${status}`);
    if (!response.ok || body.status !== "ok" || degraded.length > 0) {
      return fail(
        "remote readiness",
        `${url} returned HTTP ${response.status}, status=${body.status ?? "missing"}${
          degraded.length ? `, degraded: ${degraded.join(", ")}` : ""
        }`,
      );
    }
    return ok("remote readiness", `${url} reports all readiness checks ok.`);
  } catch (err) {
    return fail(
      "remote readiness",
      err instanceof Error ? err.message : "Could not fetch readiness endpoint.",
    );
  }
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const marker = result.status === "ok" ? "OK" : "FAIL";
    console.log(`${marker} ${result.name}: ${result.detail}`);
  }
}

const help = hasFlag("--help") || hasFlag("-h");
if (help) {
  console.log(
    [
      "Usage: pnpm run verify:production -- [--url https://your-app.example] [--skip-db] [--skip-smoke] [--skip-qa]",
      "",
      "Checks production env policy, built artifacts, source-contract smoke tests,",
      "local or Dockerfile-provisioned ffmpeg availability, saved gallery QA evidence,",
      "database schema readiness, and optionally the deployed /api/readyz endpoint.",
      "",
      "Gallery QA evidence defaults to qa-output/live-gallery/quality-report.json and",
      "qa-output/live-gallery/manual-acceptance.json. Override with --qa-report and --qa-acceptance.",
    ].join("\n"),
  );
  process.exit(0);
}

const results: CheckResult[] = [
  checkProductionEnv(),
  checkBuiltArtifacts(),
  await checkSecuritySmoke(),
  await checkFfmpeg(),
  checkGalleryQaEvidence(),
  await checkDatabaseSchema(),
];

const url = argValue("--url") ?? process.env.VERIFY_PRODUCTION_URL ?? null;
if (url) {
  results.push(await checkRemoteReadiness(url));
}

printResults(results);

if (results.some((result) => result.status === "fail")) {
  process.exit(1);
}

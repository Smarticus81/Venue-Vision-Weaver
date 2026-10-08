/**
 * Outreach studio demo: build sample emails from real public venue websites
 * without a database, storage bucket, or mail provider.
 *
 *   pnpm run outreach:demo -- --out qa-output/outreach-demo \
 *     --site https://www.example-venue.com/ --site https://another-venue.com/
 *
 * For each site it runs the same research → copy → render pipeline the
 * control plane uses, saves the venue photos it found (with their source
 * URLs), and writes email-light.html, email-dark.html, email.txt, and
 * manifest.json into <out>/<slug>/. With XAI_API_KEY set Grok writes the
 * copy; otherwise the deterministic fallback is used and the manifest says so.
 * Nothing is ever sent.
 *
 * --allow-local lets the SSRF guard accept 127.0.0.1 so a fixture site can be
 * used offline (development only).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://demo:demo@localhost:5432/demo";
process.env.APP_BASE_URL ??= "https://dreemer.co";
process.env.OUTREACH_SENDER_NAME ??= "Sam";
process.env.OUTREACH_POSTAL_ADDRESS ??= "Dreemer · 1234 Example Street · Austin, TX 78701";

const research = await import("../control-plane/outreach/venueResearch.js");
const { writeCopy } = await import("../control-plane/outreach/copywriter.js");
const { attributeFacts, citableFacts } = await import("../control-plane/vetting/facts.js");
const { renderOutreachEmail, buildListUnsubscribeHeaders, splitParagraphs } = await import(
  "../control-plane/outreach/emailTemplate.js"
);
const { controlPlaneAiConfigured } = await import("../control-plane/grok.js");

interface Args {
  out: string;
  sites: string[];
  allowLocal: boolean;
  contact: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "qa-output/outreach-demo", sites: [], allowLocal: false, contact: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--out" && value) {
      args.out = value;
      i += 1;
    } else if (flag === "--site" && value) {
      args.sites.push(value);
      i += 1;
    } else if (flag === "--sites" && value) {
      args.sites.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (flag === "--contact" && value) {
      args.contact = value;
      i += 1;
    } else if (flag === "--allow-local") {
      args.allowLocal = true;
    }
  }
  if (args.sites.length === 0) {
    console.error("Pass at least one --site <url>.");
    process.exit(2);
  }
  return args;
}

function slugify(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  } catch {
    return url.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  }
}

async function plainFetchPage(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "DreemerResearch/demo" } });
  if (!res.ok) return null;
  return { finalUrl: res.url || url, html: await res.text() };
}

async function plainFetchBinary(url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(args.out);
  await mkdir(outRoot, { recursive: true });
  const base = research.defaultResearchDeps();
  const summary: Array<Record<string, unknown>> = [];

  for (const [index, site] of args.sites.entries()) {
    const slug = slugify(site);
    const dir = path.join(outRoot, slug);
    const imagesDir = path.join(dir, "images");
    await mkdir(imagesDir, { recursive: true });
    console.log(`\n[${index + 1}/${args.sites.length}] ${site}`);

    const deps: import("../control-plane/outreach/venueResearch.js").ResearchDeps = {
      fetchPage: args.allowLocal ? plainFetchPage : base.fetchPage,
      fetchBinary: args.allowLocal ? plainFetchBinary : base.fetchBinary,
      processImage: base.processImage,
      async store(relativePath, buffer) {
        const file = path.join(imagesDir, path.basename(relativePath));
        await writeFile(file, buffer);
        return file;
      },
      refineFacts: base.refineFacts,
    };

    const result = await research.researchVenue(
      { prospectId: index + 1, name: slug.replace(/-/g, " "), website: site, region: null },
      deps,
    );
    console.log(`  research: ${result.status}; ${result.images.length} photo(s); spaces: ${result.facts.spaces.join(", ") || "—"}`);
    for (const warning of result.warnings) console.log(`  ! ${warning}`);

    // Only facts attributed to a page the demo actually fetched may be cited.
    const verifiedFacts = citableFacts(attributeFacts(result.facts, result.pages));
    console.log(`  verified facts: ${verifiedFacts.map((fact) => `${fact.kind}=${fact.value}`).join(", ") || "none (a real draft would be refused)"}`);
    const copy = await writeCopy({
      facts: result.facts,
      verifiedFacts,
      prospectName: result.facts.name ?? slug,
      contactName: args.contact,
      ask: "preview",
      contactCount: 0,
      stepGuidance: null,
    });
    console.log(`  copy: ${copy.notes.source} (${copy.notes.wordCount} words) — "${copy.subjects[0]}" / "${copy.subjects[1]}"`);

    const venueName = result.facts.name ?? slug;
    const images = result.images
      .filter((image) => image.selected)
      .map((image) => ({
        url: `file://${image.objectKey}`,
        alt: image.altText,
        width: image.width,
        height: image.height,
        sourceHost: new URL(image.sourceUrl).hostname.replace(/^www\./, ""),
      }));
    const unsubscribeUrl = `${process.env.APP_BASE_URL}/api/outreach/unsubscribe/demo-token`;
    const common = {
      subject: copy.subjects[0],
      greeting: copy.greeting,
      paragraphs: splitParagraphs(copy.body),
      signOffLines: copy.signOff.split(/\r?\n/).filter(Boolean),
      ctaLabel: copy.ctaLabel,
      ctaUrl: `mailto:sam@dreemer.co?subject=${encodeURIComponent(`Free preview for ${venueName}`)}`,
      images,
      venueName,
      unsubscribeUrl,
      postalAddress: process.env.OUTREACH_POSTAL_ADDRESS!,
    };
    const light = renderOutreachEmail(common);
    const dark = renderOutreachEmail({ ...common, forceScheme: "dark" });

    await writeFile(path.join(dir, "email-light.html"), light.html);
    await writeFile(path.join(dir, "email-dark.html"), dark.html);
    await writeFile(path.join(dir, "email.txt"), light.text);
    const manifest = {
      site,
      fetchedAt: new Date().toISOString(),
      research: {
        status: result.status,
        sourceUrls: result.sourceUrls,
        facts: result.facts,
        warnings: result.warnings,
        images: result.images.map(({ objectKey, ...image }) => ({ ...image, file: path.relative(dir, objectKey) })),
      },
      copy: { subjects: copy.subjects, greeting: copy.greeting, body: copy.body, signOff: copy.signOff, ctaLabel: copy.ctaLabel, notes: copy.notes },
      headers: buildListUnsubscribeHeaders(unsubscribeUrl, null),
      grokConfigured: controlPlaneAiConfigured(),
    };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    summary.push({ slug, site, status: result.status, images: result.images.length, copySource: copy.notes.source, subjects: copy.subjects });
  }

  const readme = [
    "# Outreach studio samples",
    "",
    `Generated ${new Date().toISOString()} by \`pnpm run outreach:demo\`. Copy source: ${controlPlaneAiConfigured() ? "Grok" : "deterministic fallback (XAI_API_KEY not set)"}. Nothing was sent.`,
    "",
    "| Venue site | Research | Photos | Copy | Subject options |",
    "| --- | --- | --- | --- | --- |",
    ...summary.map(
      (row) =>
        `| ${row.site} | ${row.status} | ${row.images} | ${row.copySource} | ${(row.subjects as string[]).map((s) => `“${s}”`).join(" / ")} |`,
    ),
    "",
    "Each folder holds `email-light.html`, `email-dark.html`, `email.txt`, `manifest.json` (facts, every source URL, image provenance), and the photos under `images/`.",
    "",
  ].join("\n");
  await writeFile(path.join(outRoot, "README.md"), readme);
  console.log(`\nWrote ${summary.length} sample(s) to ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

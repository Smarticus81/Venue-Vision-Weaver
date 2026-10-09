import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_COUPLE_REFERENCES } from "./referenceImage.js";
import { ObjectStorageService } from "./objectStorage.js";
import { uploadBufferAsUploadObject } from "./websiteMediaImport.js";

/*
 * "Render a sample" for venue onboarding (shared-contract 2.3
 * POST /venues/{slug}/sample-gallery). The demo couple's reference photos
 * come from DEMO_COUPLE_DIR (default lib/brand/assets/demo-couple). Per the
 * workstream plan a sample is offered only when the demo photos exist;
 * otherwise the route answers 409 demo_not_configured.
 * A sample does not debit a credit (the dashboard promises that), but the
 * account must be fundable (trial clock and balance, 402 otherwise) and each
 * organization has a lifetime allowance of MAX_SAMPLE_STARTS_PER_ORG starts
 * counted from a persistent log (venueSetup.ts), so deleting samples, adding
 * venues or opening more organizations never buys unlimited renders.
 */

export const DEMO_NOT_CONFIGURED_CODE = "demo_not_configured";
export const SAMPLE_COUPLE_NAME = "Sample couple";
export const MAX_SAMPLE_PHOTOS = 3;

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface DemoPhoto {
  path: string;
  contentType: string;
}

/** Candidate directories, most specific first; the first one holding enough photos wins. */
export function demoCoupleDirCandidates(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const candidates: string[] = [];
  const configured = env.DEMO_COUPLE_DIR?.trim();
  if (configured) candidates.push(path.resolve(cwd, configured));
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ["lib/brand/assets/demo-couple", "../../lib/brand/assets/demo-couple"]) {
    candidates.push(path.resolve(cwd, rel));
  }
  for (const rel of ["../../../../lib/brand/assets/demo-couple", "../../../lib/brand/assets/demo-couple"]) {
    candidates.push(path.resolve(here, rel));
  }
  return Array.from(new Set(candidates));
}

/** Image files in `dir` (jpg/png/webp), sorted by name; empty when the directory is missing. */
export async function listDemoPhotosIn(dir: string): Promise<DemoPhoto[]> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return [];
    const names = (await readdir(dir)).filter((name) => !name.startsWith(".")).sort();
    const photos: DemoPhoto[] = [];
    for (const name of names) {
      const contentType = IMAGE_TYPES[path.extname(name).toLowerCase()];
      if (!contentType) continue;
      const full = path.join(dir, name);
      const fileInfo = await stat(full).catch(() => null);
      if (!fileInfo?.isFile() || fileInfo.size === 0) continue;
      photos.push({ path: full, contentType });
    }
    return photos;
  } catch {
    return [];
  }
}

/**
 * The demo couple's photos (2-3 of them) or null when no candidate directory
 * holds at least MIN_COUPLE_REFERENCES usable images.
 */
export async function findDemoCouplePhotos(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Promise<DemoPhoto[] | null> {
  for (const dir of demoCoupleDirCandidates(env, cwd)) {
    const photos = await listDemoPhotosIn(dir);
    if (photos.length >= MIN_COUPLE_REFERENCES) return photos.slice(0, MAX_SAMPLE_PHOTOS);
  }
  return null;
}

export interface SamplePhotoDeps {
  findPhotos(): Promise<DemoPhoto[] | null>;
  read(filePath: string): Promise<Buffer>;
  store(buffer: Buffer, contentType: string): Promise<string>;
}

export type SamplePhotoOutcome =
  | { ok: true; objectKeys: string[] }
  | { ok: false; status: 409; error: string; code: typeof DEMO_NOT_CONFIGURED_CODE };

/** Copy the demo photos into private upload objects for a new sample session. */
export async function prepareSamplePhotos(deps: SamplePhotoDeps): Promise<SamplePhotoOutcome> {
  const photos = await deps.findPhotos();
  if (!photos || photos.length < MIN_COUPLE_REFERENCES) {
    return {
      ok: false,
      status: 409,
      error: "Sample galleries are not set up on this server yet (no demo couple photos). Upload a couple photo set to try the flow.",
      code: DEMO_NOT_CONFIGURED_CODE,
    };
  }
  const objectKeys: string[] = [];
  for (const photo of photos.slice(0, MAX_SAMPLE_PHOTOS)) {
    const buffer = await deps.read(photo.path);
    objectKeys.push(await deps.store(buffer, photo.contentType));
  }
  return { ok: true, objectKeys };
}

export function defaultSamplePhotoDeps(storage = new ObjectStorageService()): SamplePhotoDeps {
  return {
    findPhotos: () => findDemoCouplePhotos(),
    read: (filePath) => readFile(filePath),
    store: (buffer, contentType) => uploadBufferAsUploadObject(storage, buffer, contentType),
  };
}

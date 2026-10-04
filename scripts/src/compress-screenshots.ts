/** Convert every PNG under the given directory to a JPEG next to it and remove the PNG. */
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) files.push(full);
  }
  return files;
}

const root = path.resolve(process.argv[2] ?? "qa-output/outreach-demo");
for (const file of await walk(root)) {
  const target = file.replace(/\.png$/i, ".jpg");
  await sharp(file).jpeg({ quality: 82, mozjpeg: true }).toFile(target);
  const before = (await stat(file)).size;
  const after = (await stat(target)).size;
  await unlink(file);
  console.log(`  ${path.relative(root, target)} ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB`);
}

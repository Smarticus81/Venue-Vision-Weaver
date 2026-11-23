/** Authoring tool, never imported by the app. Credentials stay in process memory. */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
const [reference, promptFile, output] = process.argv.slice(2);
if (!reference || !promptFile || !output) throw Error('Usage: node generate-venue-film.mjs reference.jpg prompt.txt output.mp4');
if (!process.env.GOOGLE_AI_API_KEY) throw Error('GOOGLE_AI_API_KEY is required');
try { await access(output); throw Error('Output already exists; use a new filename to avoid a duplicate paid job'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const request = {
  model: 'gemini-omni-1.2-flash',
  input: [
    { type: 'image', data: (await readFile(reference)).toString('base64'), mime_type: reference.endsWith('.png') ? 'image/png' : 'image/jpeg' },
    { type: 'text', text: await readFile(promptFile, 'utf8') },
  ],
  response_format: { type: 'video', duration: '8s', aspect_ratio: '16:9', resolution: '1080p' },
};
console.log('Submitting one 8-second image-to-video generation with Gemini Omni 1.2 Flash.');
const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_AI_API_KEY },
  body: JSON.stringify(request), signal: AbortSignal.timeout(300_000),
});
const result = await response.json();
if (!response.ok) throw Error(`Video generation HTTP ${response.status}: ${result.error?.message ?? 'request rejected'}`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(`${output}.json`, JSON.stringify({ id: result.id, status: result.status, model: result.model, usage: result.usage }, null, 2));
function findVideo(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'video' && typeof value.data === 'string') return value.data;
  for (const child of Object.values(value)) { const found = findVideo(child); if (found) return found; }
  return null;
}
const data = result.output_video?.data ?? findVideo(result);
if (!data) throw Error(`No video returned; saved metadata. Status: ${result.status}; keys: ${Object.keys(result).join(', ')}`);
const bytes = Buffer.from(data, 'base64');
await writeFile(output, bytes);
console.log(JSON.stringify({ output, bytes: bytes.length, id: result.id, status: result.status, model: result.model }));

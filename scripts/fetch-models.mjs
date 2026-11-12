// Download AI model files into public/models so the app serves them itself (on-device AI, no third-party calls at runtime).
// Run: npm run fetch-models   ·   Models are not committed (public/models is gitignored).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const MODELS = [
  {
    file: 'migan_pipeline_v2.onnx',
    url: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    license: 'https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS',
  },
];

const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const m of MODELS) {
  const dest = new URL(m.file, dir);
  const have = await readFile(dest).catch(() => null);
  const hash = b => createHash('sha256').update(b).digest('hex');
  if (have && (!m.sha256 || hash(have) === m.sha256)) { console.log(`✓ ${m.file} (present)`); continue; }
  console.log(`↓ ${m.file}`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer()), h = hash(buf);
  if (m.sha256 && h !== m.sha256) throw new Error(`${m.file}: sha256 mismatch (${h})`);
  await writeFile(dest, buf);
  const lic = await fetch(m.license).then(r => r.text());
  await writeFile(new URL(m.file.replace(/\.onnx$/, '.LICENSE.txt'), dir), lic);
  console.log(`✓ ${m.file} ${(buf.length / 1048576).toFixed(1)} MB sha256=${h}${m.sha256 ? '' : '  ← pin this in scripts/fetch-models.mjs'}`);
}

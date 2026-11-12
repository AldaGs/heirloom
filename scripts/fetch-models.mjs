// Download AI model files into public/models so the app serves them itself (on-device AI, no third-party calls at runtime).
// Run: npm run fetch-models   ·   Models are not committed (public/models is gitignored).
//
// Models we convert ourselves (NAFNet, MobileSAM) have no upstream download. Either build them locally
// (python3 scripts/convert_*.py) or host the built files and set HEIRLOOM_MODELS_URL to that folder,
// e.g. a GitHub release: https://github.com/<owner>/<repo>/releases/download/models-v1
// Missing models never fail a deploy: the app shows those AI tools as "not installed on this server".
// Pass --strict to make a missing model an error (for a release build that must have every tool).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const MODELS = [
  {
    file: 'migan_pipeline_v2.onnx',
    url: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    license: 'https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS',
  },
  {
    // No upstream ONNX for width32: built from the official checkpoint by scripts/convert_nafnet.py (deterministic output).
    file: 'nafnet_sidd_w32.onnx',
    build: 'python3 scripts/convert_nafnet.py   (needs: pip install torch onnx)',
    license: 'https://raw.githubusercontent.com/megvii-research/NAFNet/main/LICENSE',
    sha256: '3c19cdf9639c1458ebdfa0b2d77a3a6d5652ee60e0c7c9d9437b5b26651792d1',
  },
  {
    // MobileSAM (Apache-2.0): encoder runs once per photo, decoder per click. Built by scripts/convert_mobilesam.py (deterministic).
    file: 'mobilesam_encoder.onnx',
    build: 'python3 scripts/convert_mobilesam.py   (needs: pip install torch onnx timm)',
    license: 'https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/LICENSE',
    sha256: '8c8c964f4bd5d850f9a4ee680d01fd3cccb667d04daaa7d14be878a214cdcee8',
  },
  {
    file: 'mobilesam_decoder.onnx',
    build: 'python3 scripts/convert_mobilesam.py   (needs: pip install torch onnx timm)',
    license: 'https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/LICENSE',
    sha256: 'ed3ed0820c26da1d744c5e5c3e858e9f80765e422fae03b9ecb5412b85ba0c32',
  },
];

const STRICT = process.argv.includes('--strict'), HOSTED = process.env.HEIRLOOM_MODELS_URL;
const dir = new URL('../public/models/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const m of MODELS) {
  const dest = new URL(m.file, dir);
  const have = await readFile(dest).catch(() => null);
  const hash = b => createHash('sha256').update(b).digest('hex');
  if (have && (!m.sha256 || hash(have) === m.sha256)) { console.log(`✓ ${m.file} (present)`); continue; }
  const url = m.url ?? (HOSTED && `${HOSTED.replace(/\/$/, '')}/${m.file}`);
  if (!url) {
    const msg = `${m.file} ${have ? `has the wrong sha256 (${hash(have)})` : 'missing'} — build it with: ${m.build}, or set HEIRLOOM_MODELS_URL`;
    if (STRICT) throw new Error(msg);
    console.warn(`⚠ skipped ${msg}. Its AI tool will show as not installed.`); continue;
  }
  console.log(`↓ ${m.file}`);
  const res = await fetch(url);
  if (!res.ok) {
    if (STRICT || !m.build) throw new Error(`${m.file}: HTTP ${res.status} from ${url}`);
    console.warn(`⚠ skipped ${m.file}: HTTP ${res.status} from ${url}. Its AI tool will show as not installed.`); continue;
  }
  const buf = Buffer.from(await res.arrayBuffer()), h = hash(buf);
  if (m.sha256 && h !== m.sha256) throw new Error(`${m.file}: sha256 mismatch (${h})`);
  await writeFile(dest, buf);
  const lic = await fetch(m.license).then(r => r.text());
  await writeFile(new URL(m.file.replace(/\.onnx$/, '.LICENSE.txt'), dir), lic);
  console.log(`✓ ${m.file} ${(buf.length / 1048576).toFixed(1)} MB sha256=${h}${m.sha256 ? '' : '  ← pin this in scripts/fetch-models.mjs'}`);
}

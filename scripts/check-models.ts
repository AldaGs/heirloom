// Check that every AI model the app downloads is on Hugging Face with the pinned sha256 (HEAD only, nothing downloaded).
// Run: npm run check-models
//
// The app fetches models from Hugging Face at runtime (src/ai.ts MODELS), so deploys carry no model files.
// MI-GAN comes from its author's repo. NAFNet and MobileSAM have no upstream ONNX: build them with
//   python3 scripts/convert_nafnet.py     (pip install torch onnx)
//   python3 scripts/convert_mobilesam.py  (pip install torch onnx timm)
// then upload the three .onnx files to the models repo (MODELS_REPO, default AldaGs/heirloom-models):
//   hf upload AldaGs/heirloom-models public/models . --include "*.onnx"
// The conversions are deterministic, so the pinned sha256 in src/ai.ts matches a correct build.
import { MODELS, MODELS_REPO } from '../src/ai.ts';

let bad = 0;
console.log(`models repo: ${MODELS_REPO}`);
for (const m of Object.values(MODELS)) {
  // don't follow the redirect to the CDN: the hash headers are on Hugging Face's own response
  const res = await fetch(m.url, { method: 'HEAD', redirect: 'manual' }).catch((e: Error) => ({ ok: false, status: e.message, headers: new Headers() }));
  const r = { ...res, ok: res.ok || (typeof res.status === 'number' && res.status >= 300 && res.status < 400), status: res.status, headers: res.headers };
  const tag = r.headers.get('x-linked-etag')?.replace(/"/g, ''), size = +(r.headers.get('x-linked-size') ?? 0);
  const ok = r.ok && tag === m.sha256;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${m.file}  ${r.ok ? (tag === m.sha256 ? `${(size / 1048576).toFixed(1)} MB` : `sha256 ${tag ?? 'unknown'} ≠ pinned ${m.sha256}`) : `HTTP ${r.status}`}  ${m.url}`);
}
if (bad) { console.error(`${bad} model(s) unavailable: their AI tools will report "model unavailable" in Settings.`); process.exit(1); }

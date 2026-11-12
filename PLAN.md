# Heirloom — Build Plan

Source of truth: `fixer-design/` (screens + `source/*.dc.html`) and `fixer-design/FIXER_IMPROVEMENTS.md`.
"Fixer" in the design = **Heirloom** in the app. Each phase ships a deployable app.

## Stack decisions
| Layer | Choice | Why |
|---|---|---|
| Build | Vite + React + TypeScript | Spec suggests React; we now have 3+ views, panels, history |
| Pipeline | Keep the WebGL2 shader, move to RGBA16F linear textures | Works today everywhere; WebGPU later only if WebGL2 limits us |
| Raw decode | LibRaw → WASM in a Web Worker | Spec §8 |
| Storage | IndexedDB/OPFS for library + previews; File System Access for sidecars (desktop) | Local-first, §7 |
| App shell | Installable PWA (manifest + service worker) | Offline, §4/§7 |
| Deferred | Tauri/Capacitor shells, E2E sync, AI modules | Not needed until core is solid (§10 steps 8) |

Design tokens (§9) go in one `tokens.css`: bg `#0F0F10`, canvas `#0B0B0C`, panel `#17171A`, bar `#141416`, border `#2A2A2F`, text `#ECEAE6`, text-2 `#C9C7C2`, muted `#9A9AA3`, accent `#F0A43A`, on-accent `#1A1206`. Fonts: Inter + JetBrains Mono. Touch targets ≥ 44 px.

---

## Phase 1 — Shell + Encoder control (§1, §10.1)
- Port to Vite/React; rename to Heirloom; tokens + fonts.
- **Desktop Develop layout** (desktop-develop.png): top bar (logo, Library/Develop/Export tabs, filename · dimensions, undo/redo, Export button), left column (Navigator, Presets, History), center canvas + bottom bar (Before/After, Fit/100%/200%, stars, flag), right column (histogram, EXIF row, tool tabs: Edit/Crop/Heal/Mask/Eye, Basic panel with Auto/Reset), filmstrip.
- **Encoder component** (port `.enc`, `fxRound`, down/move/up from `Main.dc.html`): relative drag, 320 px full range (×5 finer with Shift), pointer capture, double-click reset, number field (Enter applies, ↑↓ ±1, Shift ±10, bad input reverts on blur), value bar (Temp blue→amber, Tint green→magenta), `aria-hidden` strip.
- Basic panel: WB (Temp in Kelvin, Tint), Tone (Exposure…Blacks), Presence (Texture, Clarity, Dehaze, Vibrance, Saturation).
- **History panel**: undo/redo stack, click a step to jump back.
- Presets: Original, Warm Film, Cool Matte, Punchy, Mono (just stored settings objects).
- ✅ Done when: §1 acceptance criteria pass; ⌘/Ctrl+Z works.

## Phase 2 — Raw + real pipeline (§10.2)
- LibRaw WASM worker: decode NEF/CR3/ARW/DNG/RAF → 16-bit linear RGB + EXIF + as-shot WB.
- Upload as RGBA16F; all math in linear light; Temp/Tint from as-shot Kelvin.
- Auto button: per-photo auto exposure/WB from histogram (§5: computed per photo, never copied).
- Texture/Clarity/Dehaze (needs blur passes → multi-pass renderer).
- Zoom Fit/100%/200% + pan, Navigator rectangle linked to viewport.
- Real-photo regression check: small script rendering a reference image and comparing to a stored output.
- ✅ Done when: a raw file opens, edits, exports at full res with EXIF row filled.

## Phase 3 — Library, sidecars, previews (§2, §7, §10.3)
- Import folders (File System Access on desktop, file picker on mobile).
- Background preview builder in a worker → WebP in OPFS.
- **Sidecars**: `<name>.heirloom.json` (+ `.xmp` subset for WB/tone/presence) next to originals; library reads them back with no account.
- Library grid (mobile-library.png): filter chips (All, Picks, Edited, Raw only, …), date sections, "edited" badge, stars, + import button, virtualized for 5,000 photos at 60 fps.
- Ratings, pick/reject flags, color labels with custom names (§6).
- Filmstrip in Develop driven by the library.
- PWA install + offline.
- ✅ Done when: §7 acceptance criteria pass; reload keeps everything.

## Phase 4 — Cull view (§2, §10.4)
- Full-screen single photo, keys `P` / `X` / `1–5` / arrows, next 2 preloaded, < 100 ms per step.
- Compare 2–4 shots with linked zoom.

## Phase 5 — Mobile + Focus mode (§3, §10.5)
- Mobile Develop (mobile-develop.png): header (back, name, RAW · f · shutter · ISO, undo, share), photo ≥ 40% height, mini histogram, Before/After pill, accordion groups (Light, Color, Effects, Detail, Optics) with edited counts, bottom nav (Presets, Crop, Edit, Masking, Remove). Encoders full width, 520 px range; long-press/two-finger fine mode; `navigator.vibrate(5)` tick.
- Mobile Library bottom nav (Photos, Albums, Presets, Settings).
- **Focus mode** (`F`): hide panels, floating encoder for last-used control.
- Remember last tool + open group per device; reorder/pin/hide panels, saved per device.
- Per-group reset; "Reset but keep crop".

## Phase 6 — Remaining tools (§4, §10.6)
Tone curve (parametric + point) → Color Mixer (HSL) → Color Grading → Detail (sharpen, denoise) → Optics (lens profiles, CA, vignette) → Geometry/Crop (straighten, aspect) → Calibration. Full EXIF panel.

## Phase 7 — Batch + Export (§5, §6, §10.7)
- Sync settings to selection with **batch preview grid**, failures listed per photo.
- Export presets: size, JPEG/AVIF/WebP/TIFF, output sharpening, watermark.
- Import presets with a per-step summary afterwards.

## Phase 8 — Optional
E2E-encrypted sync (CRDT edit log), opt-in on-device AI modules (masking, denoise, remove) with a global off switch, Tauri/Capacitor shells (memory-card eject, haptics on iOS), whole-library export/import.

---

## Open decisions
1. Mobile fine-mode gesture: long-press vs two-finger drag (§1).
2. Pricing model (§7) — product owner.
3. Masking/Remove tabs in the mobile nav ship disabled until Phase 8, or hidden?

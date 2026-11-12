# Fixer — What We Do Better Than Lightroom

A guide for building Fixer, a web-based raw photo developer that runs on Windows, macOS, iOS and Android.
Each item lists the **user problem** (taken from real Lightroom complaints), the **Fixer solution**, and **acceptance criteria** to check during development.

Design references live in `screens/` (PNG renders) and `source/` (the canvas source files: HTML + JS for each screen).

---

## 0. Product principles

1. **Raw development first.** Fixer is a digital darkroom. Core tonal and color tools come before generative AI.
2. **Precision on every device.** Every value can be dragged, typed, nudged with the keyboard, or reset.
3. **The photo is the hero.** The interface uses as little space as it can and gets out of the way.
4. **Your files are yours.** Edits are saved in an open format next to the photos. No lock-in, works offline.
5. **Predictable.** Tools don't move between releases, batch actions show a preview first, and the app remembers what you used last.

---

## 1. Precision encoder sliders ✅ designed

**Problem**
- Sliders on Lightroom mobile jump by 5 or 10 points when touched.
- There is no way to type exact values on mobile.
- Desktop sliders are "too small for fast work."

**Solution: the rotary-encoder control**
- A horizontal strip drawn like the front of a knurled knob: dark at the edges, light in the middle, with vertical ridges that roll as the value changes.
- **Relative drag:** dragging changes the value by how far you move, not where you touch. Touching it never makes the value jump.
- **Fine mode:** hold Shift on desktop for 5× precision. On mobile, a two-finger drag or long-press could do the same (to decide).
- **Double-click / double-tap** resets to the default.
- **Number field** next to every control: type a value, press Enter to apply. Arrow keys step by one, Shift+Arrow by ten.
- **Value bar** under the strip: fills from the default to the current value. Temp and Tint show a blue→amber and green→magenta line.
- The encoder itself is `aria-hidden`. Keyboard and screen-reader users work through the labelled number field.

**Implementation notes** (see `source/Main.dc.html` → `.enc`, `fxRound`, the `down/move/up` handlers)
```css
.enc {
  touch-action: none; cursor: ew-resize; border-radius: 6px;
  background-image:
    linear-gradient(180deg, rgba(0,0,0,.55), transparent 32% 68%, rgba(0,0,0,.6)),          /* top/bottom depth */
    linear-gradient(90deg, #09090A, rgba(9,9,10,.7) 14%, transparent 38% 62%, rgba(9,9,10,.7) 86%, #09090A), /* cylinder shading */
    repeating-linear-gradient(90deg, #C9C9CE 0 1px, #6E6E74 1px 2px, #202023 2px 5px),     /* ridges */
    linear-gradient(90deg, #141416, #55555B 50%, #141416);                                   /* base */
  background-position: 0 0, 0 0, var(--offset) 0, 0 0;  /* offset = normalized value × travel */
}
```
- Sensitivity: desktop moves the full range over **320 px** of drag (×5 with Shift); mobile over **520 px**.
- Use `setPointerCapture` so the drag keeps working when the pointer leaves the strip.
- Round values to the slider's step and keep them within its min and max.
- For production, consider a WebGL/canvas encoder that compresses the ridges toward the edges (true cylinder perspective) and adds a light haptic tick on mobile (`navigator.vibrate(5)` on Android; iOS needs a native wrapper).

**Acceptance criteria**
- [ ] Touching or tapping an encoder never changes its value.
- [ ] Shift-drag is at least 5× finer than a normal drag.
- [ ] Typing a value updates the photo live, and invalid text reverts when the field loses focus.
- [ ] Every control can be operated with the keyboard alone.

---

## 2. Fast culling

**Problem**
- "Performance and lag even on powerful computers."
- Previews aren't made until a photo is displayed, which makes culling slow.

**Solution**
- Build previews in the background as soon as photos are imported (Web Worker + WASM raw decode → cached JPEG/WebP previews in OPFS/IndexedDB).
- A dedicated **Cull** view: one photo at a time, keyboard-first (`P` pick, `X` reject, `1–5` rate, arrow keys move), with the next two photos already loaded.
- Optional side-by-side comparison of 2–4 similar shots, with linked zoom.

**Acceptance criteria**
- [ ] Moving to the next photo in Cull shows a full-screen preview in under 100 ms once previews are built.
- [ ] Scrolling the grid stays at 60 fps with 5,000 photos.

---

## 3. A compact, customizable interface

**Problem**
- "Too much empty space in the interface," which makes the photo smaller.
- Mobile tool panels take up half the screen.
- Updates move tools around, and the app "refuses to remember what I used on my last action."

**Solution**
- **Focus mode** (`F` / a swipe): hides every panel, leaving only the photo plus a floating encoder for the last-used setting.
- Panels you can **reorder, pin and hide**. The layout is saved per device.
- **Remember the last tool and open section** per device. Mobile reopens on the same accordion group (already in the mobile design).
- Mobile settings use **collapsible groups** (Light, Color, Effects, Detail, Optics), each showing how many settings are edited ✅ designed.
- A **stable layout promise**: no tool moves without a release note and a one-tap way to bring it back.

**Acceptance criteria**
- [ ] On phones, the photo takes up at least 40% of the screen height while editing.
- [ ] Panel layout and the last-used tool survive a reload.

---

## 4. Raw development first, AI optional

**Problem**
- Users want "a digital darkroom," not a "retouching tool."
- They object to the "ongoing AI obsession" and AI features "nobody asked for."

**Solution**
- Ship excellent core tools first: tone curve (parametric + point), color mixer (HSL), color grading, detail, lens/optics, geometry, calibration.
- AI features (masking, denoise, remove) are **opt-in modules** that you can download and run on the device where possible. They are never required for the core workflow.
- Full EXIF/metadata panel.

**Acceptance criteria**
- [ ] Every core tool works offline without an account.
- [ ] AI modules can be turned off completely in Settings.

---

## 5. Batch actions you can trust

**Problem**
- Sync sometimes skips photos.
- Auto-straighten copies one angle to every photo instead of analyzing each one.
- Import presets silently ignore some steps (e.g. AI Denoise).

**Solution**
- **Batch preview:** before applying, show a grid of every selected photo with the result, and flag any photo that a step can't be applied to.
- "Auto" adjustments are calculated **per photo**, never copied from one photo to the rest.
- Import presets check each step and show a summary after import ("142 of 142 photos: profile, lens, denoise applied").

**Acceptance criteria**
- [ ] A batch either applies to every selected photo or lists exactly which ones failed and why.

---

## 6. Small workflow features users keep asking for

- **Reset but keep crop** (and reset a single group, e.g. only Color). The desktop and mobile designs already reset per section.
- **Eject the memory card after import.**
- **Custom export presets** with any size, format (JPEG/AVIF/WebP/TIFF), sharpening, and watermark. On mobile, sizes go beyond "2048 px or full size."
- **Color labels** with custom names.
- **Undo history** that you can click to jump back to any step ✅ designed (desktop History panel).

---

## 7. Open files, fair pricing

**Problem**
- Subscription price increases, a hard cancellation process, and catalogs locked to one app are top reasons photographers leave.

**Solution**
- Edits are stored as **open sidecar files** (`.xmp`-compatible where possible, plus a JSON settings file) next to the originals.
- **Local-first:** the full app works offline as an installed PWA. Sync between devices is optional (end-to-end encrypted).
- Export or import the whole library (sidecars + collections) in one step.
- A clear, simple pricing model, decided by the product owner.

**Acceptance criteria**
- [ ] Deleting Fixer leaves every edit readable on disk.
- [ ] Opening the same folder on another device picks up all edits without needing a Fixer account.

---

## 8. Cross-platform architecture (suggested)

| Layer | Choice |
|---|---|
| UI | React (or Solid) + CSS tokens below; installed PWA as the base |
| Raw decode | LibRaw compiled to WebAssembly, in a Web Worker |
| Image pipeline | WebGPU, with WebGL2 as a fallback; 16-bit float, linear light |
| Storage | OPFS for previews/cache, File System Access API for folders (desktop); native file pickers on mobile |
| Native shells | Tauri (Windows, macOS) and Capacitor (iOS, Android) for file system, haptics and memory-card access |
| Sync | Optional: CRDT edit log per photo, so edits made offline merge cleanly |

---

## 9. Design tokens (from the canvas)

| Token | Value | Use |
|---|---|---|
| `bg` | `#0F0F10` | App background |
| `canvas` | `#0B0B0C` | Behind the photo |
| `panel` | `#17171A` | Side panels |
| `bar` | `#141416` | Top bar, filmstrip, mobile nav |
| `border` | `#2A2A2F` | Dividers |
| `text` | `#ECEAE6` | Primary text |
| `text-2` | `#C9C7C2` | Labels |
| `muted` | `#9A9AA3` | Secondary text |
| `accent` | `#F0A43A` | Safelight amber: active state, value fill, primary button |
| `on-accent` | `#1A1206` | Text on amber |
| Type | Inter (UI), JetBrains Mono (values, EXIF) | |
| Touch target | ≥ 44 px | All interactive elements on mobile |

---

## 10. Suggested build order

1. Encoder control + number field (shared component) → Basic panel.
2. WASM raw decode + WebGPU pipeline for the Basic settings.
3. Sidecar save/load, local-first library, background previews.
4. Cull view.
5. Mobile accordion layout + Focus mode.
6. Remaining panels (Curve, Color Mixer, Grading, Detail, Optics, Geometry).
7. Batch preview, export presets.
8. Optional sync, AI modules.

---

## Sources (user research)

- [Mobile slider jumps 5–10 points](https://community.adobe.com/questions-680/adjusting-a-slider-on-lightroom-mobile-causes-jumping-of-5-or-10-decimal-points-1625271)
- [Request: typed values for Temp/Hue on mobile](https://community.adobe.com/feature-requests-681/p-manual-input-for-hue-and-temperature-etc-adjustments-in-lightroom-mobile-660798)
- [Long-standing UX and performance issues](https://community.adobe.com/questions-675/multiple-long-standing-ux-and-performance-issues-in-lightroom-and-photoshop-on-windows-1617808)
- [Suggestions for improving the desktop UI](https://community.adobe.com/questions-680/suggestions-for-improving-the-desktop-app-ui-1634332)
- [Customize UI request](https://community.adobe.com/feature-requests-681/p-customize-ui-1615225)
- [The obsession with AI](https://community.adobe.com/questions-680/the-obsession-with-ai-1645195)
- [Focus on raw development](https://community.adobe.com/questions-675/stop-calling-lightroom-a-retouching-tool-and-focus-on-raw-development-1559988)
- [Image too small when editing (iPad)](https://community.adobe.com/t5/lightroom-ecosystem-cloud-based-ideas/p-image-too-small-when-editing/m-p/12233925)
- [Fstoppers: The real reason photographers are leaving Adobe](https://fstoppers.com/software/real-reason-photographers-are-leaving-adobe-901527)

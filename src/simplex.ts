// ---- 2D simplex noise (Gustavson), returns ~[-1, 1] ----
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1337; // fixed seed: same field every load
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  return Uint8Array.from([...p, ...p]);
})();
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
export function simplex2(x: number, y: number) {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - i + t, y0 = y - j + t;
  const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  for (const [dx, dy, g] of [[x0, y0, PERM[ii + PERM[jj]]], [x1, y1, PERM[ii + i1 + PERM[jj + j1]]], [x2, y2, PERM[ii + 1 + PERM[jj + 1]]]]) {
    const a = 0.5 - dx * dx - dy * dy;
    if (a > 0) { const gr = GRAD[g & 7]; n += a ** 4 * (gr[0] * dx + gr[1] * dy); }
  }
  return 70 * n;
}

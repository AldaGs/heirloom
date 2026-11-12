import { applySidecar, syncLayers, toSidecar, type Photo } from './library.ts';
import { accept, inventory, syncKey, toSend, type Inventory, type SyncGroup } from './sync-core.ts';
import type { Link } from './p2p.ts';

type Put = { type: 'put'; key: string; group: SyncGroup; t: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Summary = { sent: number; received: number; keptOurs: number; onlyHere: number; onlyThere: number };

const b64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type: 'image/png' });

async function payload(p: Photo, g: SyncGroup) {
  if (g === 'rating') return { rating: p.rating };
  if (g === 'flag') return { flag: p.flag, reject: !!p.reject };
  if (g === 'label') return { label: p.label };
  if (g === 'album') return { album: p.album ?? '' };
  // edits: the sidecar (settings + history with layer refs) + the layer images those steps use
  const used = new Set(p.hist.slice(0, p.hi + 1).flatMap(s => [s.rt, ...(s.mk ?? [])]).filter(Boolean) as string[]);
  const layers: Record<string, string> = {};
  for (const id of used) if (p.layers?.[id]) layers[id] = await b64(p.layers[id]);
  return { sidecar: toSidecar(p), layers };
}

function applyGroup(p: Photo, g: SyncGroup, d: any): Photo { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (g === 'rating') return { ...p, rating: d.rating };
  if (g === 'flag') return { ...p, flag: d.flag, reject: d.reject };
  if (g === 'label') return { ...p, label: d.label };
  if (g === 'album') return { ...p, album: d.album || undefined };
  const layers = Object.fromEntries(Object.entries(d.layers as Record<string, string>).map(([k, v]) => [k, unb64(v)]));
  const r = applySidecar({ ...p, layers: { ...p.layers, ...layers } }, d.sidecar);
  return syncLayers({ ...p, v: r.v, hist: r.hist, hi: r.hi, layers: r.layers }); // edits only; meta/album travel separately
}

/**
 * One sync exchange over an open link. Both sides run the same code: say what we have, send what's newer here,
 * apply what's newer there. `photos()` must return the live list; `commit` replaces photos by id.
 */
export function runSync(link: Link, photos: () => Photo[], commit: (changed: Photo[]) => void, status: (s: string) => void): Promise<Summary> {
  return new Promise((resolve, reject) => {
    const sum: Summary = { sent: 0, received: 0, keptOurs: 0, onlyHere: 0, onlyThere: 0 };
    let theirsDone = false, oursDone = false;
    const finish = () => { if (theirsDone && oursDone) resolve(sum); };
    link.onclose = () => reject(new Error('The other device disconnected'));
    link.onmessage = async m => {
      try {
        if (m.type === 'hello') {
          const mine = inventory(photos()), theirs = m.inv as Inventory;
          sum.onlyHere = Object.keys(mine).filter(k => !(k in theirs)).length;
          sum.onlyThere = Object.keys(theirs).filter(k => !(k in mine)).length;
          const byKey = new Map(photos().map(p => [syncKey(p), p]));
          const jobs = toSend(mine, theirs);
          for (const [i, j] of jobs.entries()) {
            status(`Sending ${i + 1} / ${jobs.length}…`);
            const p = byKey.get(j.key)!;
            for (const g of j.groups) { await link.send({ type: 'put', key: j.key, group: g, t: p.mt![g]!, data: await payload(p, g) } satisfies Put); sum.sent++; }
          }
          await link.send({ type: 'done' }); oursDone = true; finish();
        } else if (m.type === 'put') {
          const put = m as Put, p = photos().find(x => syncKey(x) === put.key);
          const merged = p && accept(p, put.group, put.t, x => applyGroup(x, put.group, put.data));
          if (merged) { commit([merged]); sum.received++; } else sum.keptOurs++;
          status(`Received ${sum.received}…`);
        } else if (m.type === 'done') { theirsDone = true; finish(); }
      } catch (e) { reject(e); }
    };
    link.send({ type: 'hello', inv: inventory(photos()) }).catch(reject);
  });
}

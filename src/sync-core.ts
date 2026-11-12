// Device-to-device sync: what to send and how to merge (pure, testable).
// Each photo carries a modified-time per group; per group the newest write wins (an LWW map: order-independent,
// so two devices that exchange states always converge).

// fine-grained so independent changes on two devices (a rating here, a label there) both survive
export const SYNC_GROUPS = ['edits', 'rating', 'flag', 'label', 'album'] as const;
export type SyncGroup = typeof SYNC_GROUPS[number];
export type Stamps = Partial<Record<SyncGroup, number>>;

type P = { name: string; date: number; w: number; h: number; mt?: Stamps; v: unknown; hist: unknown; hi: number; layers?: unknown;
  rating: number; flag: boolean; reject?: boolean; label: number; album?: string };

/** Same photo on two devices = same file name, capture time and pixel size (ids differ per device). */
export const syncKey = (p: Pick<P, 'name' | 'date' | 'w' | 'h'>) => `${p.name}|${p.date}|${p.w}x${p.h}`;

/** Which groups changed between two versions of a photo (used to stamp modified times). */
export function changedGroups(a: P | undefined, b: P): SyncGroup[] {
  if (!a) return [];
  const out: SyncGroup[] = [];
  if (a.v !== b.v || a.hist !== b.hist || a.hi !== b.hi || a.layers !== b.layers) out.push('edits');
  if (a.rating !== b.rating) out.push('rating');
  if (a.flag !== b.flag || !!a.reject !== !!b.reject) out.push('flag');
  if (a.label !== b.label) out.push('label');
  if ((a.album ?? '') !== (b.album ?? '')) out.push('album');
  return out;
}
export const stamp = (prev: P | undefined, next: P, now = Date.now()): Stamps => {
  const mt = { ...next.mt };
  // a group whose stamp already moved came from sync: keep the sender's time, don't re-stamp it as a local edit
  for (const g of changedGroups(prev, next)) if ((next.mt?.[g] ?? 0) === (prev?.mt?.[g] ?? 0)) mt[g] = now;
  return mt;
};

export type Inventory = Record<string, Stamps>; // syncKey → stamps
export const inventory = (ps: P[]): Inventory => Object.fromEntries(ps.map(p => [syncKey(p), p.mt ?? {}]));

/** Groups of mine the peer should receive: strictly newer here (ties: nothing to do; both have the same write). */
export function toSend(mine: Inventory, theirs: Inventory) {
  const out: { key: string; groups: SyncGroup[] }[] = [];
  for (const [key, st] of Object.entries(mine)) {
    if (!(key in theirs)) continue; // photo not on the other device: edits only travel with photos both have
    const groups = SYNC_GROUPS.filter(g => (st[g] ?? 0) > (theirs[key][g] ?? 0));
    if (groups.length) out.push({ key, groups });
  }
  return out;
}

/** Apply an incoming group if it's newer than what we have. Returns the merged photo or null if ours wins. */
export function accept<T extends P>(p: T, group: SyncGroup, t: number, apply: (p: T) => T): T | null {
  if ((p.mt?.[group] ?? 0) >= t) return null;
  return { ...apply(p), mt: { ...p.mt, [group]: t } };
}

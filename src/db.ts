// Tiny IndexedDB wrapper: 'photos' (keyPath id) + 'kv' (folder handles, prefs).
let dbp: Promise<IDBDatabase> | undefined;
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('heirloom', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('photos', { keyPath: 'id' }); r.result.createObjectStore('kv'); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

function req<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return (dbp ??= open()).then(db => new Promise<T>((res, rej) => {
    const r = f(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  }));
}

export const db = {
  allPhotos: <T>() => req<T[]>('photos', 'readonly', s => s.getAll()),
  putPhoto: (p: object) => req<void>('photos', 'readwrite', s => s.put(p)),
  get: <T>(k: string) => req<T | undefined>('kv', 'readonly', s => s.get(k)),
  set: (k: string, v: unknown) => req<void>('kv', 'readwrite', s => s.put(v, k)),
  clearAll: () => Promise.all([req<void>('photos', 'readwrite', s => s.clear()), req<void>('kv', 'readwrite', s => s.clear())]),
};

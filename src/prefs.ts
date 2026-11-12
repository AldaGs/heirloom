import { useEffect, useState } from 'react';

// Per-device UI prefs (FIXER_IMPROVEMENTS §3: layout + last tool remembered per device).
// localStorage is exactly "this device"; it can be unavailable (private mode), so every access is guarded.
export function usePref<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem('heirloom:' + key); return s ? (JSON.parse(s) as T) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem('heirloom:' + key, JSON.stringify(v)); } catch { /* not persisted */ } }, [key, v]);
  return [v, setV] as const;
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q), on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

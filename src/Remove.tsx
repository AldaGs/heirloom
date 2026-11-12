import { useEffect, useRef, useState } from 'react';

/** Brush layer over the Develop canvas (full frame, unrotated). Internal size = the loaded image's pixels. */
export function RemoveOverlay({ canvas, brushRef, size }: { canvas: HTMLCanvasElement; brushRef: React.MutableRefObject<HTMLCanvasElement | null>; size: number }) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const c = canvas.getBoundingClientRect(), p = (canvas.closest('.center') as HTMLElement).getBoundingClientRect();
      setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(canvas);
    const st = canvas.closest('.stage'); st?.addEventListener('scroll', measure); // follow the image when zoomed in
    return () => { ro.disconnect(); st?.removeEventListener('scroll', measure); };
  }, [canvas]);
  useEffect(() => {
    const b = brushRef.current!;
    if (b.width !== canvas.width || b.height !== canvas.height) { b.width = canvas.width; b.height = canvas.height; }
  }, [canvas.width, canvas.height, brushRef]);

  const at = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect(), b = brushRef.current!;
    return { x: ((e.clientX - r.left) / r.width) * b.width, y: ((e.clientY - r.top) / r.height) * b.height };
  };
  const paint = (p: { x: number; y: number }) => {
    const b = brushRef.current!, g = b.getContext('2d')!;
    // size is a % of the shorter edge so it feels the same on any resolution
    const lw = (Math.min(b.width, b.height) * size) / 100;
    g.strokeStyle = g.fillStyle = 'rgba(240,80,60,1)'; g.lineWidth = lw; g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    if (last.current) { g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); }
    else { g.arc(p.x, p.y, lw / 2, 0, Math.PI * 2); g.fill(); }
    last.current = p;
  };
  return (
    <canvas ref={brushRef} className="remove-brush" style={{ ...box, cursor: 'crosshair' }} aria-label="Paint over what to remove"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); last.current = null; paint(at(e)); }}
      onPointerMove={e => { if (e.buttons) paint(at(e)); }}
      onPointerUp={() => { last.current = null; }} />
  );
}

export function RemovePanel({ size, setSize, busy, msg, hasRetouch, onRemove, onClear, onRevert, done }: {
  size: number; setSize: (n: number) => void; busy: boolean; msg: string; hasRetouch: boolean;
  onRemove: () => void; onClear: () => void; onRevert: () => void; done: () => void;
}) {
  return (
    <section className="adjust remove-panel">
      <div className="sec-head"><h3>Remove</h3><button className="primary" onClick={done}>Done</button></div>
      <p className="muted small">Paint over the object or spot, then Remove. On-device AI (MI-GAN). For large areas, use several small strokes.</p>
      <label className="brush-size">Brush <input type="range" min={0.5} max={15} step={0.5} value={size} onChange={e => setSize(+e.target.value)} /> <span>{size}%</span></label>
      <div className="row">
        <button className="primary" onClick={onRemove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>
        <button className="ghost bordered" onClick={onClear} disabled={busy}>Clear brush</button>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
      {hasRetouch && <button className="ghost bordered" onClick={onRevert} disabled={busy}>Revert all removals</button>}
    </section>
  );
}

export function DenoisePanel({ strength, setStrength, progress, msg, pixels, onRun, onCancel, done }: {
  strength: number; setStrength: (n: number) => void; progress: { done: number; total: number } | null; msg: string; pixels: number;
  onRun: () => void; onCancel: () => void; done: () => void;
}) {
  const busy = !!progress;
  return (
    <section className="adjust remove-panel">
      <div className="sec-head"><h3>AI Denoise</h3><button className="primary" onClick={done} disabled={busy}>Done</button></div>
      <p className="muted small">Removes sensor noise from the whole photo, on this device (NAFNet). Runs on the unedited image, so your sliders still apply on top. {(pixels / 1e6).toFixed(0)} MP: seconds with WebGPU, minutes on CPU.</p>
      <label className="brush-size">Strength <input type="range" min={10} max={100} step={5} value={strength} disabled={busy} onChange={e => setStrength(+e.target.value)} /> <span>{strength}%</span></label>
      <div className="row">
        {busy ? <button className="ghost bordered" onClick={onCancel}>Cancel</button> : <button className="primary" onClick={onRun}>Denoise</button>}
      </div>
      {progress && progress.total > 1 && <progress max={progress.total} value={progress.done} aria-label="Denoise progress" />}
      {progress && progress.total > 1 && <p className="small muted">Tile {progress.done} of {progress.total}</p>}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}

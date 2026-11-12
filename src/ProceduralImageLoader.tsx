import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { simplex2 } from './simplex.ts';

// Soft color blobs on a dark base, like generative-image placeholders. Drawn at 1/10 resolution and
// upscaled + CSS-blurred: cheap, and the low-res render is what makes it look silky.
const SCALE = 10;
const BLOBS = ['#F0A43A', '#8B5CF6', '#2DD4BF', '#F472B6']; // amber accent + violet, teal, rose

/** Animated aurora field with a light sheen sweep. Pauses off-screen / when inactive; static under reduced motion. */
export function NoiseField({ active = true, className = '' }: { active?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!, g = c.getContext('2d')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 1, h = 1, raf = 0, visible = true;

    const draw = (now: number) => {
      const T = now / 1000, m = Math.max(w, h);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#0B0B0C'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      BLOBS.forEach((col, i) => {
        // each blob drifts on its own slow noise path and breathes in size
        const x = (0.5 + 0.45 * simplex2(T * 0.12, i * 7.3)) * w;
        const y = (0.5 + 0.45 * simplex2(i * 3.1, T * 0.1 + 20)) * h;
        const r = m * (0.45 + 0.15 * simplex2(T * 0.2, i * 11));
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, col + '73'); grd.addColorStop(1, col + '00');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
      });
      // diagonal sheen sweeping every ~2.4 s
      const p = ((T / 2.4) % 1) * 2 - 0.5;
      const sh = g.createLinearGradient(p * w - h, 0, p * w + h, h);
      sh.addColorStop(0.4, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.10)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)');
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
    };

    const loop = () => {
      cancelAnimationFrame(raf);
      if (!active || !visible || reduced) return;
      const tick = (t: number) => { draw(t); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(([e]) => {
      // tiny backing store on purpose (upscaled by CSS); DPR is irrelevant for a blurred field
      w = c.width = Math.max(2, Math.ceil(e.contentRect.width / SCALE));
      h = c.height = Math.max(2, Math.ceil(e.contentRect.height / SCALE));
      draw(performance.now());
    });
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; loop(); });
    ro.observe(c); io.observe(c);
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [active]);

  return <canvas ref={ref} className={'noise ' + className} aria-hidden="true" />;
}

type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string };

/** <img> wrapper: aurora field while loading, 500 ms crossfade (with a de-blur) to the image on load. */
export function ProceduralImageLoader({ src, alt = '', width, height, className = '', onLoad, onError, style, ...img }: Props) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // cached images can finish before React attaches onLoad
    setLoaded(!!imgRef.current?.complete && imgRef.current.naturalWidth > 0);
  }, [src]);

  return (
    <span className={'pil ' + className} style={{ width, height, ...style }} data-loaded={loaded} aria-busy={!loaded}>
      <NoiseField active={!loaded} />
      <img {...img} ref={imgRef} src={src} alt={alt} width={width} height={height}
        onLoad={e => { setLoaded(true); onLoad?.(e); }}
        onError={e => { setLoaded(true); onError?.(e); }} />
    </span>
  );
}

'use client';

/**
 * Drawn-signature canvas.
 *
 * Pointer Events are used rather than separate mouse/touch handlers so one code
 * path covers finger, stylus and mouse. Two details matter on a phone and are
 * easy to get wrong:
 *
 *  • `touch-action: none` — without it the browser claims the gesture for
 *    scrolling and the stroke breaks up mid-signature.
 *  • `setPointerCapture` — keeps receiving points when the finger slides
 *    outside the canvas, so a signature with a long tail does not get clipped
 *    into two strokes.
 *
 * The backing store is sized to `devicePixelRatio` and the context scaled to
 * match, so strokes are crisp on retina screens instead of upscaled and blurry.
 * A ResizeObserver re-runs that setup on rotation or layout change, preserving
 * whatever has already been drawn.
 *
 * Output is a PNG data URL. The canvas is filled opaque white first: a
 * transparent PNG composited onto a white PDF page renders black-on-black in
 * some viewers, and a signature nobody can see is worse than no signature.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eraser } from 'lucide-react';
import { CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED } from './shared';

/** Ink colour — near-black, matching the contract body text. */
const INK = '#0D0D0D';
const LINE_WIDTH = 2.4;

export interface SignaturePadHandle {
  /** PNG data URL, or null when nothing has been drawn. */
  toDataUrl: () => string | null;
  clear: () => void;
}

export interface SignaturePadProps {
  /** Called with true once at least one stroke exists, false when cleared. */
  onChange?: (hasSignature: boolean) => void;
  disabled?: boolean;
  height?: number;
}

/**
 * Exposes `toDataUrl()` / `clear()` to the parent through a ref rather than
 * lifting pixel state into React. The canvas IS the state; mirroring it into a
 * data URL on every stroke would re-encode the whole image on each pointer move.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { onChange, disabled, height = 180 },
  ref,
) {
  const t = useTranslations('consultantPortal.contract');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [empty, setEmpty] = useState(true);

  /** Size the backing store to the CSS box × DPR, preserving existing ink. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const nextW = Math.round(rect.width * dpr);
    const nextH = Math.round(rect.height * dpr);
    if (canvas.width === nextW && canvas.height === nextH) return;

    // Resizing a canvas clears it, so carry the current drawing across.
    const previous = hasDrawn.current ? canvas.toDataURL('image/png') : null;

    canvas.width = nextW;
    canvas.height = nextH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = INK;

    if (previous) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = previous;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (hasDrawn.current ? (canvasRef.current?.toDataURL('image/png') ?? null) : null),
    clear,
  }));

  useEffect(() => {
    resize();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [resize]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    // Keep the stroke alive if the finger leaves the canvas mid-signature.
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap with no movement should still leave a mark (a dot on an "i").
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    markDrawn();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  function markDrawn() {
    if (hasDrawn.current) return;
    hasDrawn.current = true;
    setEmpty(false);
    onChange?.(true);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = INK;
    hasDrawn.current = false;
    setEmpty(true);
    onChange?.(false);
  }

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-2xl border bg-white"
        style={{ borderColor: CP_LIGHT_BORDER }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-label={t('signatureCanvasLabel')}
          className="block w-full cursor-crosshair"
          // touch-action must be none, or the browser scrolls instead of drawing.
          style={{ height, touchAction: 'none' }}
        />
        {empty && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="text-sm" style={{ color: CP_LIGHT_FAINT }}>{t('signatureHint')}</span>
          </div>
        )}
        {/* Baseline the signature sits on — a familiar cue that this is a
            signature field and not a drawing area. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed"
          style={{ borderColor: CP_LIGHT_BORDER }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[11px]" style={{ color: CP_LIGHT_MUTED }}>{t('signatureLegal')}</p>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[#F7F8F9] disabled:opacity-40"
          style={{ color: CP_LIGHT_MUTED }}
        >
          <Eraser className="size-3.5" />
          {t('clear')}
        </button>
      </div>
    </div>
  );
});

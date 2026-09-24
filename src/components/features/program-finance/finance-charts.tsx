'use client';

/**
 * The two pictures of a program's money.
 *
 * Colours are validated for colour-blind readers (dataviz validator, light and
 * dark) and never carry meaning alone: every bar is labelled with its name and
 * its signed amount, and every curve point with its value on hover.
 *
 *   money kept  — green   #1b7e40 / #1d9a6c
 *   money out   — red     #c91d1d / #e8604c
 *   still owed  — blue    #2563eb / #6a8ff0
 */
import { useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export const FINANCE_TONE = {
  kept: 'bg-[#1b7e40] dark:bg-[#1d9a6c]',
  out: 'bg-[#c91d1d] dark:bg-[#e8604c]',
  owed: 'bg-[#2563eb] dark:bg-[#6a8ff0]',
} as const;

export type FinanceTone = keyof typeof FINANCE_TONE;

export interface WaterfallStep {
  label: string;
  /** Where the bar starts and ends, in DZD. */
  from: number;
  to: number;
  /** The signed amount printed beside it. */
  display: string;
  tone: FinanceTone;
  /** A subtotal — drawn bold, from zero. */
  total?: boolean;
}

/**
 * Floating bars from billed down to net profit. Horizontal, so the labels
 * stay readable on a phone; logical start/end, so it mirrors in Arabic.
 */
export function Waterfall({ steps, ariaLabel }: { steps: WaterfallStep[]; ariaLabel: string }) {
  const values = steps.flatMap((s) => [s.from, s.to]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const at = (v: number) => ((v - min) / span) * 100;

  return (
    <div role="table" aria-label={ariaLabel} className="space-y-1.5">
      {steps.map((s) => {
        const lo = Math.min(s.from, s.to);
        const hi = Math.max(s.from, s.to);
        const width = Math.max(at(hi) - at(lo), hi > lo ? 0.6 : 0);
        return (
          <div role="row" key={s.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
            <span role="rowheader" className={cn('truncate text-sm', s.total ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {s.label}
            </span>
            <span role="cell" className="relative h-6 rounded-sm bg-muted/50">
              {min < 0 && (
                // The zero line, once profit goes below it.
                <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ insetInlineStart: `${at(0)}%` }} />
              )}
              <span
                aria-hidden
                className={cn('absolute inset-y-1 rounded-[3px]', FINANCE_TONE[s.tone], !s.total && 'opacity-90')}
                style={{ insetInlineStart: `${at(lo)}%`, width: `${width}%` }}
              />
            </span>
            <span role="cell" className={cn('whitespace-nowrap text-end text-sm tabular-nums', s.total ? 'font-semibold text-foreground' : 'text-muted-foreground')} dir="ltr">
              {s.display}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface CurvePoint {
  date: string;
  /** Running total at the end of that day. */
  value: number;
  /** What that day added. */
  delta: number;
}

/**
 * A running total over time, drawn as steps — nothing changes between two
 * sign-ups — with a crosshair and a tooltip on hover or touch.
 */
export function CumulativeCurve({
  points,
  format,
  formatDate,
  ariaLabel,
  deltaLabel,
}: {
  points: CurvePoint[];
  format: (n: number) => string;
  formatDate: (iso: string) => string;
  ariaLabel: string;
  deltaLabel: (delta: string) => string;
}) {
  const W = 560, H = 180, PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 24;
  const ref = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const t = points.map((p) => Date.parse(`${p.date}T12:00:00Z`));
    // Room after the last day, so the final level reads as a plateau rather
    // than a riser lost under the axis label — and a single day still gets a
    // visible width.
    const first = t[0]!;
    const last = t[t.length - 1]!;
    const t0 = first - (points.length === 1 ? 86_400_000 : 0);
    const t1 = last + Math.max(86_400_000, (last - first) * 0.08);
    const maxV = Math.max(1, ...points.map((p) => p.value));
    const x = (ms: number) => PAD_L + ((ms - t0) / (t1 - t0 || 1)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - v / maxV) * (H - PAD_T - PAD_B);
    // Step path: flat until the next day, then up.
    let d = `M ${x(t0)} ${y(0)}`;
    points.forEach((p, i) => {
      d += ` H ${x(t[i]!)} V ${y(p.value)}`;
    });
    d += ` H ${x(t1)}`;
    const area = `${d} V ${y(0)} H ${x(t0)} Z`;
    const ticks = [0, 0.5, 1].map((f) => Math.round(maxV * f));
    return { t, x, y, d, area, ticks, maxV };
  }, [points]);

  if (!geo) return null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = ref.current;
    if (!svg || !geo) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    geo.t.forEach((ms, i) => {
      if (Math.abs(geo.x(ms) - px) < Math.abs(geo.x(geo.t[best]!) - px)) best = i;
    });
    setHover(best);
  }

  const h = hover != null ? points[hover] : null;
  const hx = hover != null ? geo.x(geo.t[hover]!) : 0;

  // Time runs left to right in every language, like the axis of any chart;
  // the labels are HTML rather than SVG text so they stay legible when the
  // chart is scaled down to a phone.
  return (
    <div className="relative" dir="ltr">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none text-[#1b7e40] dark:text-[#1d9a6c]"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geo.ticks.map((v) => (
          <line key={v} x1={PAD_L} x2={W - PAD_R} y1={geo.y(v)} y2={geo.y(v)} className="stroke-border"
            strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3 4'} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={geo.area} fill="currentColor" opacity={0.1} />
        <path d={geo.d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {h && (
          <g>
            <line x1={hx} x2={hx} y1={PAD_T} y2={H - PAD_B} className="stroke-foreground/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={hx} cy={geo.y(h.value)} r={4.5} fill="currentColor" className="stroke-card" strokeWidth={2} />
          </g>
        )}
      </svg>
      {geo.ticks.filter((v) => v > 0).map((v) => (
        <span
          key={v}
          aria-hidden
          className="pointer-events-none absolute right-2 -translate-y-full pb-0.5 text-[11px] tabular-nums text-muted-foreground"
          style={{ top: `${(geo.y(v) / H) * 100}%` }}
        >
          {format(v)}
        </span>
      ))}
      <div aria-hidden className="absolute inset-x-2 bottom-0 flex justify-between text-[11px] text-muted-foreground">
        <span>{formatDate(points[0]!.date)}</span>
        {points.length > 1 && <span>{formatDate(points[points.length - 1]!.date)}</span>}
      </div>
      {h && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-32 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min(Math.max((hx / W) * 100, 12), 78)}%`, transform: 'translateX(-50%)' }}
        >
          <p className="text-muted-foreground">{formatDate(h.date)}</p>
          <p className="font-semibold tabular-nums text-foreground" dir="ltr">{format(h.value)}</p>
          {h.delta > 0 && <p className="text-muted-foreground" dir="ltr">{deltaLabel(format(h.delta))}</p>}
        </div>
      )}
    </div>
  );
}

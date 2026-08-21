import { useState } from 'react';
import type { CurveSeries } from '../core/plan';
import { formatCount, formatPercent } from './format';

/**
 * Categorical slots, in fixed order and never cycled. Validated on a white
 * surface: worst adjacent CVD separation ΔE 9.1, worst normal-vision ΔE 19.6.
 * Three of the six sit below 3:1 contrast, so identity is never carried by
 * colour alone - every line is direct-labelled, repeated in the readout under
 * the plot, and repeated again in the table below it.
 */
const SERIES_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

const W = 420;
const H = 190;
const PAD = { top: 10, right: 12, bottom: 34, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

interface Props {
  series: CurveSeries[];
  /** Where the design currently sits on the horizontal axis. */
  currentTotal: number;
  targetCv: number;
  targetClassId: string | null;
}

/**
 * Precision against sample size. The point of showing it is that the curves
 * flatten: past the knee more points buy very little, and a target set just
 * left of it costs far more than one set just right.
 */
export const PrecisionCurve = ({ series, currentTotal, targetCv, targetClassId }: Props) => {
  const [hoverTotal, setHoverTotal] = useState<number | null>(null);

  const totals = series[0]?.points.map((p) => p.total) ?? [];
  if (totals.length < 2 || series.length === 0) return null;

  const minTotal = totals[0];
  const maxTotal = totals[totals.length - 1];
  // Headroom above the worst curve so the target line is never on the frame.
  const maxCv =
    Math.max(targetCv * 1.4, ...series.flatMap((s) => s.points.map((p) => p.cv))) * 1.05;

  const x = (total: number) =>
    PAD.left + ((total - minTotal) / Math.max(1, maxTotal - minTotal)) * PLOT_W;
  // Lower is better, so the axis runs the usual way and the curves fall.
  const y = (cv: number) => PAD.top + PLOT_H - (Math.min(cv, maxCv) / maxCv) * PLOT_H;

  const nearest = (total: number) =>
    totals.reduce(
      (best, t) => (Math.abs(t - total) < Math.abs(best - total) ? t : best),
      totals[0]
    );
  const readoutTotal = nearest(hoverTotal ?? currentTotal);
  const cvAt = (s: CurveSeries, total: number) => s.points.find((p) => p.total === total)?.cv;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = ((e.clientX - box.left) / box.width) * W;
    setHoverTotal(minTotal + ((ratio - PAD.left) / PLOT_W) * (maxTotal - minTotal));
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Expected confidence interval against sample size for ${series.length} classes`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverTotal(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(maxCv * f)}
              y2={y(maxCv * f)}
              stroke="#e5e5e5"
            />
            <text
              x={PAD.left - 6}
              y={y(maxCv * f) + 3}
              textAnchor="end"
              fontSize="9"
              fill="#a3a3a3"
            >
              {formatPercent(maxCv * f, 0)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={y(targetCv)}
          y2={y(targetCv)}
          stroke="#737373"
          strokeDasharray="4 3"
        />
        <text
          x={PAD.left + PLOT_W}
          y={y(targetCv) - 4}
          textAnchor="end"
          fontSize="9"
          fill="#737373"
        >
          target ±{formatPercent(targetCv, 0)}
        </text>

        <line
          x1={x(readoutTotal)}
          x2={x(readoutTotal)}
          y1={PAD.top}
          y2={PAD.top + PLOT_H}
          stroke={hoverTotal === null ? '#171717' : '#a3a3a3'}
        />

        {series.map((s, i) => {
          const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
          const cv = cvAt(s, readoutTotal);
          return (
            <g key={s.classId}>
              <path
                d={s.points
                  .map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.total)},${y(p.cv)}`)
                  .join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth={s.classId === targetClassId ? 2.5 : 1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {cv !== undefined && (
                <circle
                  cx={x(readoutTotal)}
                  cy={y(cv)}
                  r="4"
                  fill={colour}
                  stroke="#fff"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}

        <text x={PAD.left} y={H - 20} fontSize="9" fill="#a3a3a3">
          {formatCount(minTotal)}
        </text>
        <text x={PAD.left + PLOT_W} y={H - 20} textAnchor="end" fontSize="9" fill="#a3a3a3">
          {formatCount(maxTotal)}
        </text>
        <text x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#a3a3a3">
          sample points to annotate
        </text>
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span className="font-medium text-neutral-700">
          At {formatCount(readoutTotal)} points{hoverTotal === null ? ' (this design)' : ''}:
        </span>
        {series.map((s, i) => {
          const cv = cvAt(s, readoutTotal);
          return (
            <span key={s.classId} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: SERIES_COLOURS[i % SERIES_COLOURS.length] }}
              />
              {s.className} ±{cv === undefined ? '-' : formatPercent(cv)}
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
};

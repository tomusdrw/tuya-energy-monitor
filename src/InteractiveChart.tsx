import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from './i18n';

/** Full-height day targets make small values and gaps as easy to inspect as tall bars. */
export function InteractiveChart({
  width,
  height,
  label,
  plot,
  points,
  children,
}: {
  width: number;
  height: number;
  label: string;
  plot: { left: number; right: number; top: number; bottom: number };
  points: { day: string; content: ReactNode }[];
  children: ReactNode;
}) {
  const { day } = useI18n();
  const tooltipId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const activeIndex = points.findIndex((point) => point.day === activeDay);
  const active = points[activeIndex];
  const isActive = active !== undefined;
  useEffect(() => {
    if (!isActive) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setActiveDay(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [isActive]);
  const slot = (plot.right - plot.left) / points.length;
  return (
    <div
      className="interactive-chart"
      ref={container}
      onBlur={() => setActiveDay(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setActiveDay(null);
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={label}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setActiveDay(null);
        }}
        onPointerCancel={() => setActiveDay(null)}
      >
        <g aria-hidden="true">{children}</g>
        {points.map((point, index) => (
          <rect
            key={point.day}
            x={plot.left + index * slot}
            y={plot.top}
            width={slot}
            height={plot.bottom - plot.top}
            className={`chart-hit-area${index === activeIndex ? ' active' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={day(point.day)}
            aria-describedby={index === activeIndex ? tooltipId : undefined}
            onPointerEnter={() => setActiveDay(point.day)}
            onPointerDown={() => setActiveDay(point.day)}
            onFocus={() => setActiveDay(point.day)}
          />
        ))}
      </svg>
      {active && (
        <div
          id={tooltipId}
          role="tooltip"
          className="chart-tooltip"
          style={activeIndex < points.length / 2 ? { right: 8 } : { left: 8 }}
        >
          <time dateTime={active.day}>{day(active.day)}</time>
          {active.content}
        </div>
      )}
    </div>
  );
}

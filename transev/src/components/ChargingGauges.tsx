import React from 'react';

/**
 * Circular gauge. When `percent` is a real 0-100 value (e.g. SoC) it renders
 * a determinate ring that animates to that fill. When `percent` is
 * undefined - which is the common case, since the API doesn't expose a
 * reliable "% of target" for most sessions - it renders an indeterminate
 * spinning arc instead of fabricating a fake percentage.
 */
export const RingGauge: React.FC<{
  percent?: number | null;
  size?: number;
  strokeWidth?: number;
  active?: boolean;
  children?: React.ReactNode;
}> = ({ percent, size = 132, strokeWidth = 10, active = true, children }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = percent != null ? Math.max(0, Math.min(100, percent)) : null;
  const offset = clamped != null ? circumference * (1 - clamped / 100) : circumference * 0.75;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={clamped == null && active ? 'animate-spin' : ''}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-brand-50"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: clamped != null ? 'stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)' : undefined }}
        />
        <defs>
          <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7dab49" />
            <stop offset="100%" stopColor="#4d7a22" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
};

/**
 * Lightweight SVG area sparkline for a client-accumulated series (e.g. live
 * energy samples gathered while this screen polls/streams). Not a substitute
 * for real historical telemetry - just a visual sense of "it's climbing".
 */
export const EnergySparkline: React.FC<{ values: number[]; className?: string; height?: number }> = ({
  values,
  className = '',
  height = 44,
}) => {
  if (values.length < 2) {
    return (
      <div className={`flex items-center justify-center text-[11px] text-ink-300 ${className}`} style={{ height }}>
        Gathering readings…
      </div>
    );
  }
  const width = 240;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dab49" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7dab49" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-fill)" />
      <path d={linePath} fill="none" stroke="#4d7a22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - ((values[values.length - 1] - min) / range) * (height - 6) - 3} r="3.5" fill="#4d7a22" />
    </svg>
  );
};

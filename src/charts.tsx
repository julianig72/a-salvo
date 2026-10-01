export function ProgressRing({ value, size = 96, label, stroke = 8 }: { value: number; size?: number; label?: string; stroke?: number }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(clamped * 100)} % completado`}>
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--ink)" strokeWidth={stroke} strokeLinecap="round"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-value" />
    <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="ring-label" style={{ fontSize: size * 0.22 }}>{label ?? `${Math.round(clamped * 100)}%`}</text>
  </svg>;
}

/** Horizontal stacked bar showing how the plan's actions distribute across phases. */
export function PhaseBar({ counts }: { counts: { label: string; value: number; tone: string }[] }) {
  const total = counts.reduce((sum, c) => sum + c.value, 0) || 1;
  return <div className="phase-bar">
    <div className="phase-bar-track" aria-hidden="true">{counts.map(c => <span key={c.label} className={`tone-${c.tone}`} style={{ width: `${c.value / total * 100}%` }} />)}</div>
    <ul className="phase-bar-legend">{counts.map(c => <li key={c.label}><i className={`tone-${c.tone}`} />{c.label}<strong>{c.value}</strong></li>)}</ul>
  </div>;
}



export const GOUVERNORAT_PALETTE = [
  '#175F69', '#C98A2C', '#6B5CA5', '#C1508A', '#0EA5E9',
  '#059669', '#DC2626', '#818CF8', '#0D9488', '#B45309',
];

export function normalizeKey(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}


export function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 100);
}


export function pctLabel(part, total) {
  const value = pct(part, total);
  if (value === null) return 'Non calculable';
  return `${value}% (${part}/${total})`;
}


export function zeroSampleHint(total) {
  if (total === 0) return 'Aucun patient évalué.';
  return undefined;
}


export function combineHints(...hints) {
  const parts = hints.filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}


export function smallSampleHint(total, threshold = 10) {
  if (total === null || total === undefined || total === 0) return undefined;
  if (total < threshold) return `Basé sur un petit effectif (n=${total}) — à interpréter avec prudence.`;
  return undefined;
}

export function monthLabel(monthStr) {
  const d = new Date(`${monthStr}-01T00:00:00`);
  const str = d.toLocaleDateString('fr-FR', { month: 'short' });
  return str.replace('.', '');
}

export function dayLabel(dayStr) {
  return new Date(dayStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function SectionHeading({ Icon, title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 -2px' }}>
      <div style={{
        width: 26, height: 26, borderRadius: 8, background: 'var(--teal-tint)',
        color: 'var(--teal-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={14} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: -0.1 }}>{title}</p>
        {subtitle && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--slate)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

export function CardTitle({ children, hint }) {
  return (
    <div style={{ marginBottom: hint ? 2 : 0 }}>
      <h2 style={{ margin: 0 }}>{children}</h2>
      {hint && <p className="hint" style={{ marginTop: 4 }}>{hint}</p>}
    </div>
  );
}


export function HeroStatCard({ label, value, hint, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        flex: '1 1 200px', minWidth: 180,
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'box-shadow .15s, transform .15s' : undefined,
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.boxShadow = '0 4px 14px -4px rgba(18,42,48,.25)'; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <p style={{ fontSize: 12, color: 'var(--slate)', margin: 0 }}>{label}</p>
        {clickable && <span style={{ fontSize: 13, color: 'var(--teal-deep)', flexShrink: 0 }}>→</span>}
      </div>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, margin: '8px 0 0', color: 'var(--ink)' }}>
        {value}
      </p>
      {hint && <p className="hint" style={{ marginTop: 6 }}>{hint}</p>}
      {clickable && <p className="hint" style={{ marginTop: 6, color: 'var(--teal-deep)', fontWeight: 600 }}>Voir la liste des patients</p>}
    </div>
  );
}


export function MultiLineChart({ data, series, width = 640, height = 220, unitSuffix = '' }) {
  if (!data || data.length === 0) {
    return <p className="hint" style={{ padding: '30px 0', textAlign: 'center' }}>Pas encore assez de données pour tracer une tendance.</p>;
  }

  const marginLeft = 34;
  const marginBottom = 26;
  const marginTop = 16;
  const plotW = width - marginLeft - 8;
  const plotH = height - marginTop - marginBottom;

  const allValues = data.flatMap((d) => series.map((s) => d[s.key]).filter((v) => v != null));
  const maxVal = Math.max(...allValues, 1);
  const niceMax = Math.max(1, Math.ceil(maxVal * 1.15 * 10) / 10);
  const stepX = plotW / Math.max(data.length - 1, 1);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: marginTop + plotH * (1 - f),
    label: (niceMax * f).toFixed(niceMax < 5 ? 1 : 0),
  }));

  function pathFor(key) {
    let started = false;
    let d = '';
    data.forEach((row, i) => {
      const v = row[key];
      const x = marginLeft + stepX * i;
      if (v == null) { started = false; return; }
      const y = marginTop + plotH - (v / niceMax) * plotH;
      d += `${started ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
      started = true;
    });
    return d.trim();
  }

  const hasData = allValues.length > 0;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
        {gridLines.map((g) => (
          <g key={g.label}>
            <line x1={marginLeft} x2={width - 4} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth="1" />
            <text x={marginLeft - 8} y={g.y + 3} fontSize="10" fill="var(--slate)" textAnchor="end">{g.label}</text>
          </g>
        ))}

        {!hasData && (
          <text x={marginLeft + plotW / 2} y={marginTop + plotH / 2} textAnchor="middle" fontSize="12.5" fill="var(--slate)">
            Aucune donnée sur la période
          </text>
        )}

        {hasData && series.map((s) => (
          <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {hasData && series.map((s) => data.map((row, i) => {
          if (row[s.key] == null) return null;
          const x = marginLeft + stepX * i;
          const y = marginTop + plotH - (row[s.key] / niceMax) * plotH;
          return (
            <circle key={`${s.key}-${row.label}`} cx={x} cy={y} r="3" fill={s.color}>
              <title>{`${s.label} — ${row.label} : ${row[s.key]}${unitSuffix}`}</title>
            </circle>
          );
        }))}

        {data.map((row, i) => {
          const x = marginLeft + stepX * i;
          return (
            <text key={row.label} x={x} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--slate)">
              {row.label}
            </text>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 10 }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
            <span style={{ color: 'var(--slate)' }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ segments, size = 132, thickness = 20 }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
      {segments.map((seg) => {
        const frac = seg.value / total;
        const dash = frac * circumference;
        const el = (
          <circle
            key={seg.label}
            cx={c} cy={c} r={r}
            fill="none" stroke={seg.color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

export function DonutCard({ title, hint, segments, centerLabel, centerValue }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="card" style={{ flex: '1 1 320px' }}>
      <CardTitle hint={hint}>{title}</CardTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 16 }}>
        <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
          <Donut segments={segments} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--ink)' }}>
              {centerValue ?? total}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--slate)' }}>{centerLabel ?? 'total'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, maxHeight: 160, overflowY: 'auto' }}>
          {segments.map((seg) => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--ink)', flex: 1 }}>{seg.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{seg.value}</span>
              <span style={{ color: 'var(--slate)', fontSize: 11.5, minWidth: 34, textAlign: 'right' }}>
                {total > 0 ? Math.round((seg.value / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StackedBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div style={{ display: 'flex', width: '100%', height: 22, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--paper)' }}>
        {total === 0
          ? <div style={{ flex: 1 }} />
          : segments.filter((s) => s.value > 0).map((seg) => (
            <div key={seg.label} title={`${seg.label}: ${seg.value}`} style={{ width: `${(seg.value / total) * 100}%`, background: seg.color, transition: 'width 0.6s ease' }} />
          ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 18px', marginTop: 12 }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--slate)' }}>{seg.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
// Composants et helpers partagés entre OverviewTabClinicien, RegistreSepTab et
// RegistreEprTab. Extrait tel quel de l'ancien OverviewTabClinicien.jsx (aucune
// logique modifiée) pour permettre la découpe en 3 fenêtres distinctes sans
// dupliquer le code d'affichage.

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

// NOTE (correction) : un dénominateur nul (aucun dossier renseigné) ne veut
// pas dire "0 %" — cela veut dire "non calculable". pct() renvoie null dans
// ce cas ; pctLabel() formate l'affichage en conséquence.
export function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 100);
}

export function pctLabel(part, total) {
  const value = pct(part, total);
  if (value === null) return 'Non calculable';
  return `${value}% (${part}/${total})`;
}

export function monthLabel(monthStr) {
  // monthStr = 'YYYY-MM'
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

export function HeroStatCard({ label, value, hint }) {
  return (
    <div className="card" style={{ flex: '1 1 200px', minWidth: 180 }}>
      <p style={{ fontSize: 12, color: 'var(--slate)', margin: 0 }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, margin: '8px 0 0', color: 'var(--ink)' }}>
        {value}
      </p>
      {hint && <p className="hint" style={{ marginTop: 6 }}>{hint}</p>}
    </div>
  );
}

/** Camembert générique (réutilise le tracé en arc utilisé côté admin). */
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

/** Barre horizontale empilée — statuts / catégories mutuellement exclusifs. */
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

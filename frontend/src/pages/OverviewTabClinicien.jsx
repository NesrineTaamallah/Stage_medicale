import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconUsers, IconChart, IconWave, IconAlert } from '../components/Icons';

const REGISTRE_COLORS = { sep: '#175F69', epr: '#C98A2C' };

const ACTIVITY_SERIES = [
  { key: 'fiches_consultees', label: 'Fiches consultées', color: '#175F69' },
  { key: 'analyses_lancees', label: 'Analyses lancées', color: '#C98A2C' },
];

function dayLabel(dayStr) {
  return new Date(dayStr + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

const GOUVERNORAT_PALETTE = [
  '#175F69', '#C98A2C', '#6B5CA5', '#C1508A', '#0EA5E9',
  '#059669', '#DC2626', '#818CF8', '#0D9488', '#B45309',
];

const STATUT_LABELS = {
  // SEP (sep_suivi.statut_dernier_suivi)
  'Stable': 'Stable',
  'Perdu de vue': 'Perdu de vue',
  'Décédé': 'Décédé',
  // EPR (epr_suivi.statut_dernier_suivi)
  'Libre de crises': 'Libre de crises',
  'Epilepsie active': 'Épilepsie active',
  'Decede': 'Décédé',
};
const STATUT_COLORS = {
  'Stable': 'var(--success)',
  'Libre de crises': 'var(--success)',
  'Perdu de vue': 'var(--warning, orange)',
  'Epilepsie active': 'var(--error)',
  'Decede': 'var(--slate)',
  'Décédé': 'var(--slate)',
};

function statutLabel(statut) {
  if (!statut) return 'Non renseigné';
  return STATUT_LABELS[statut] || statut;
}
function statutColor(statut) {
  return STATUT_COLORS[statut] || 'var(--line)';
}

// NOTE (correction) : un dénominateur nul (aucun dossier renseigné) ne veut
// pas dire "0 %" — cela veut dire "non calculable". L'ancienne version
// renvoyait 0, ce qui affichait un taux clinique faux (ex. "0 % de bandes
// oligoclonales positives" au lieu de "donnée non disponible"). pct() renvoie
// désormais null dans ce cas ; pctLabel() formate l'affichage en conséquence.
function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 100);
}

function pctLabel(part, total) {
  const value = pct(part, total);
  if (value === null) return 'Non calculable';
  return `${value}% (${part}/${total})`;
}

function monthLabel(monthStr) {
  // monthStr = 'YYYY-MM'
  const d = new Date(`${monthStr}-01T00:00:00`);
  const str = d.toLocaleDateString('fr-FR', { month: 'short' });
  return str.replace('.', '');
}

/* ------------------------------------------------------------------ */

function SectionHeading({ Icon, title, subtitle }) {
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

function CardTitle({ children, hint }) {
  return (
    <div style={{ marginBottom: hint ? 2 : 0 }}>
      <h2 style={{ margin: 0 }}>{children}</h2>
      {hint && <p className="hint" style={{ marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

function HeroStatCard({ label, value, hint }) {
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
function Donut({ segments, size = 132, thickness = 20 }) {
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

function DonutCard({ title, hint, segments, centerLabel, centerValue }) {
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

/** Barre horizontale empilée — statuts de suivi mutuellement exclusifs. */
function StackedBar({ segments }) {
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

/** Courbe des inclusions par mois, deux séries (SEP / EPR) superposées. */
function InclusionsLineChart({ months, width = 640, height = 220 }) {
  if (!months || months.length === 0) return null;

  const marginLeft = 28;
  const marginBottom = 26;
  const marginTop = 16;
  const plotW = width - marginLeft - 8;
  const plotH = height - marginTop - marginBottom;

  const maxVal = Math.max(...months.map((m) => Math.max(m.sep, m.epr)), 1);
  const niceMax = Math.max(4, Math.ceil(maxVal / 4) * 4);
  const stepX = plotW / Math.max(months.length - 1, 1);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: marginTop + plotH * (1 - f),
    label: Math.round(niceMax * f),
  }));

  function pathFor(key) {
    return months
      .map((m, i) => {
        const x = marginLeft + stepX * i;
        const y = marginTop + plotH - (m[key] / niceMax) * plotH;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const hasData = months.some((m) => m.sep > 0 || m.epr > 0);

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
            Aucune inclusion enregistrée sur les 12 derniers mois
          </text>
        )}

        {hasData && (
          <>
            <path d={pathFor('sep')} fill="none" stroke={REGISTRE_COLORS.sep} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            <path d={pathFor('epr')} fill="none" stroke={REGISTRE_COLORS.epr} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {months.map((m, i) => {
              const x = marginLeft + stepX * i;
              return (
                <g key={m.month}>
                  <circle cx={x} cy={marginTop + plotH - (m.sep / niceMax) * plotH} r="3" fill={REGISTRE_COLORS.sep} />
                  <circle cx={x} cy={marginTop + plotH - (m.epr / niceMax) * plotH} r="3" fill={REGISTRE_COLORS.epr} />
                </g>
              );
            })}
          </>
        )}

        {months.map((m, i) => {
          const x = marginLeft + stepX * i;
          return (
            <text key={m.month} x={x} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--slate)">
              {monthLabel(m.month)}
            </text>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: REGISTRE_COLORS.sep }} />
          <span style={{ color: 'var(--slate)' }}>SEP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: REGISTRE_COLORS.epr }} />
          <span style={{ color: 'var(--slate)' }}>EPR</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Graphe à barres empilées, une barre par jour — repris du même patron que
 * l'historique d'activité admin (lisibilité immédiate : "quel jour, combien").
 */
function DailyStackedBarChart({ days, series, width = 640, height = 230 }) {
  const n = days.length;
  if (n === 0) return null;

  const marginLeft = 28;
  const marginBottom = 26;
  const marginTop = 22;
  const plotW = width - marginLeft - 8;
  const plotH = height - marginTop - marginBottom;

  const totalsPerDay = days.map((d) => series.reduce((s, ser) => s + d[ser.key], 0));
  const rawMax = Math.max(...totalsPerDay, 1);
  const niceMax = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const hasData = totalsPerDay.some((v) => v > 0);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: marginTop + plotH * (1 - f),
    label: Math.round(niceMax * f),
  }));

  const slot = plotW / n;
  const barWidth = Math.min(38, slot * 0.5);

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
            Aucune activité enregistrée sur les 7 derniers jours
          </text>
        )}

        {days.map((d, i) => {
          const x = marginLeft + slot * i + (slot - barWidth) / 2;
          let yCursor = marginTop + plotH;
          const dayTotal = totalsPerDay[i];
          const rects = series.map((ser) => {
            const v = d[ser.key];
            if (v <= 0) return null;
            const h = (v / niceMax) * plotH;
            const y = yCursor - h;
            yCursor -= h;
            return (
              <rect key={ser.key} x={x} y={y} width={barWidth} height={Math.max(h, 0)} fill={ser.color} style={{ cursor: 'pointer' }}>
                <title>{`${ser.label} — ${dayLabel(d.day)} : ${v}`}</title>
              </rect>
            );
          });
          return (
            <g key={d.day}>
              {rects}
              {dayTotal > 0 && (
                <text x={x + barWidth / 2} y={marginTop + plotH - (dayTotal / niceMax) * plotH - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--ink)">
                  {dayTotal}
                </text>
              )}
              <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--slate)">
                {dayLabel(d.day)}
              </text>
            </g>
          );
        })}
      </svg>
      {hasData && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 18px', marginTop: 14 }}>
          {series.map((ser) => (
            <div key={ser.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: ser.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--slate)' }}>{ser.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{days.reduce((a, d) => a + d[ser.key], 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function OverviewTabClinicien() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/api/clinicien/overview')
      .then((res) => setData(res.data))
      .catch(() => setError("Impossible de charger la vue d'ensemble."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center' }}>Chargement…</p>;
  }
  if (error || !data) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--error)' }}>{error || 'Erreur inattendue.'}</p>;
  }

  const t = data.totals;

  const gouvernoratSegments = data.gouvernoratRepartition.map((g, i) => ({
    label: g.gouvernorat,
    value: g.count,
    color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length],
  }));

  const statutSepSegments = data.comparatifSuivi.sep.map((s) => ({ label: statutLabel(s.statut), value: s.count, color: statutColor(s.statut) }));
  const statutEprSegments = data.comparatifSuivi.epr.map((s) => ({ label: statutLabel(s.statut), value: s.count, color: statutColor(s.statut) }));

  const irm = data.sep.activiteIrm;
  const lcr = data.sep.bandesOligoclonales;
  const cons = data.sep.consanguinite;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* =====================================================================
          1. VUE GLOBALE — les deux pathologies confondues, en un coup d'œil
      ===================================================================== */}
      <SectionHeading Icon={IconUsers} title="Vue globale" subtitle="Les deux pathologies confondues" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard label="Patients inclus au total" value={t.total_patients} />
        <HeroStatCard label="Registre SEP" value={t.total_sep} />
        <HeroStatCard label="Registre EPR" value={t.total_epr} />
        <HeroStatCard label="Nouvelles inclusions ce mois" value={t.inclusions_ce_mois} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <DonutCard
          title="Répartition par sexe"
          segments={data.sexeRepartition.map((s, i) => ({ label: s.sexe, value: s.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="patients"
        />
        <DonutCard
          title="Répartition par tranche d'âge"
          segments={data.ageRepartition.map((a, i) => ({ label: a.tranche, value: a.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="patients"
        />
        <div
          className="card"
          style={{ flex: '1 1 260px', borderLeft: data.fichesIdentite.fiches_manquantes > 0 ? '3px solid var(--amber)' : '3px solid transparent' }}
        >
          <p style={{ fontSize: 12, color: 'var(--slate)', margin: 0 }}>Fiches identité manquantes</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, margin: '8px 0 0', color: 'var(--ink)' }}>
            {data.fichesIdentite.fiches_manquantes}
          </p>
          <p className="hint" style={{ marginTop: 6 }}>
            {data.fichesIdentite.fiches_renseignees} / {data.fichesIdentite.total_patients} patients ont une fiche de coordonnées saisie.
          </p>
        </div>
      </div>

      <div className="card">
        <CardTitle>Inclusions mensuelles (12 derniers mois)</CardTitle>
        <div style={{ marginTop: 14 }}>
          <InclusionsLineChart months={data.inclusionsByMonth} />
        </div>
      </div>

      {/* =====================================================================
          2. COMPARATIF SEP vs EPR — pour situer les deux registres l'un
             par rapport à l'autre sans se plonger dans le détail de chacun
      ===================================================================== */}
      <SectionHeading Icon={IconChart} title="Comparatif SEP / EPR" subtitle="Statut de suivi de chaque registre, côte à côte" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Statut de suivi — SEP</CardTitle>
          <div style={{ marginTop: 16 }}><StackedBar segments={statutSepSegments} /></div>
        </div>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Statut de suivi — EPR</CardTitle>
          <div style={{ marginTop: 16 }}><StackedBar segments={statutEprSegments} /></div>
        </div>
      </div>

      {/* =====================================================================
          3. REGISTRE SEP — tout le détail clinique propre à cette pathologie
      ===================================================================== */}
      <SectionHeading Icon={IconWave} title="Registre SEP" subtitle="Sclérose en plaques pédiatrique" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard label="Délai diagnostic moyen" value={data.sep.delaiDiagnosticMoyen != null ? `${data.sep.delaiDiagnosticMoyen} mois` : '—'} />
        <HeroStatCard label="Score EDSS moyen (dernière visite)" value={data.sep.edssMoyen != null ? data.sep.edssMoyen : '—'} hint={`Sur ${data.sep.edssNbPatients} patient(s)`} />
        <HeroStatCard label="Poussées (90 derniers jours)" value={data.sep.pousseesRecentes90j} />
        <HeroStatCard label="Sous traitement de fond actif" value={data.sep.traitementsActifs} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Dernières IRM avec nouvelles lésions"
          value={pctLabel(irm?.avec_nouvelles_lesions, irm?.total)}
        />
        <HeroStatCard
          label="Bandes oligoclonales positives (LCR)"
          value={pctLabel(lcr?.positifs, lcr?.total)}
        />
        <HeroStatCard
          label="Consanguinité parentale"
          value={pctLabel(cons?.positifs, cons?.total)}
        />
        <HeroStatCard
          label="Délai moyen avant forme secondairement progressive"
          value={data.sep.delaiConversionSpMois != null ? `${data.sep.delaiConversionSpMois} mois` : '—'}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Répartition des formes évolutives</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.sep.formesEvolutives.map((f, i) => ({ label: f.forme, value: f.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
        </div>
        <DonutCard
          title="Répartition par gouvernorat"
          hint="Registre SEP uniquement — seul registre où ce champ est saisi actuellement."
          segments={gouvernoratSegments}
          centerLabel="patients SEP"
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle hint="Type du 1er événement clinique, et part avec récupération complète.">Présentation initiale</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {data.sep.presentationInitiale.map((p) => (
              <div key={p.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--ink)' }}>{p.type}</span>
                <span style={{ color: 'var(--slate)' }}>{p.count} patient(s) · {pctLabel(p.recuperation_complete, p.count)} récup. complète</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Lignes thérapeutiques en cours</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.sep.lignesTherapeutiques.map((l, i) => ({ label: `Ligne ${l.ligne_therapeutique}`, value: l.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
          {data.sep.motifsSwitch.length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 16, marginBottom: 6 }}>Motifs de switch les plus fréquents :</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.sep.motifsSwitch.map((m) => (
                  <div key={m.motif_switch} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--ink)' }}>{m.motif_switch}</span>
                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{m.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* =====================================================================
          4. REGISTRE EPR — tout le détail clinique propre à cette pathologie
      ===================================================================== */}
      <SectionHeading Icon={IconWave} title="Registre EPR" subtitle="Épilepsie résistante pédiatrique" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Pharmacorésistance confirmée"
          value={pctLabel(data.epr.pharmacoresistance?.confirmes, data.epr.pharmacoresistance?.total)}
        />
        <HeroStatCard label="Fréquence de crises moyenne" value={data.epr.frequenceCrisesMoyenne != null ? `${data.epr.frequenceCrisesMoyenne} /mois` : '—'} />
        <HeroStatCard label="Âge moyen au début des crises" value={data.epr.ageDebutCrisesMoyenMois != null ? `${data.epr.ageDebutCrisesMoyenMois} mois` : '—'} />
        <HeroStatCard label="Âge moyen au diagnostic pharmacorésistance" value={data.epr.ageDiagnosticPharmacoresistanceMoyenMois != null ? `${data.epr.ageDiagnosticPharmacoresistanceMoyenMois} mois` : '—'} />
        <HeroStatCard label="Durée de suivi moyenne" value={data.epr.dureeSuiviMoyenneMois != null ? `${data.epr.dureeSuiviMoyenneMois} mois` : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Répartition des étiologies</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.epr.etiologies.map((e, i) => ({ label: e.categorie, value: e.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
        </div>
        <DonutCard
          title="Types de crise (ILAE 2017)"
          segments={data.epr.typesCrise.map((tc, i) => ({ label: tc.type, value: tc.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="épisodes"
        />
      </div>

      {/* =====================================================================
          5. ALERTES — patients à revoir en priorité
      ===================================================================== */}
      <SectionHeading Icon={IconAlert} title="Alertes de suivi" subtitle="Patients à revoir en priorité" />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Suivi actif mais point de suivi > 6 mois"
          value={data.alertes.suiviEnRetard}
          hint={data.alertes.suiviEnRetard > 0 ? 'À recontacter' : undefined}
        />
        <HeroStatCard
          label="SEP sans IRM depuis > 12 mois"
          value={data.alertes.irmAncienne}
        />
        <HeroStatCard
          label="Traitements SEP à échéance (30 j)"
          value={data.alertes.traitementsEcheance}
        />
      </div>

      {/* ---------- Activité récente du clinicien ---------- */}
      <SectionHeading Icon={IconWave} title="Votre activité récente" subtitle="Vos actions des 7 derniers jours, jour par jour" />
      <div className="card">
        <CardTitle>Historique de vos actions (7 derniers jours)</CardTitle>
        <div style={{ marginTop: 14 }}>
          <DailyStackedBarChart days={data.recentActivity} series={ACTIVITY_SERIES} />
        </div>
      </div>
    </div>
  );
}
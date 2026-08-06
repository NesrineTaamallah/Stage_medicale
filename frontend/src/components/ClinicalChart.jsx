/**
 * Courbe de suivi clinique — SVG "maison", sans dépendance (le projet n'a pas
 * de lib de charts type recharts/chart.js, cf. package.json). Pensé pour les
 * deux courbes que les neurologues utilisent en pratique pour suivre chaque
 * pathologie du registre :
 *
 * - SEP pédiatrique : courbe EDSS (Expanded Disability Status Scale, 0–10)
 *   dans le temps, à chaque visite. C'est LE score de référence utilisé en
 *   consultation pour objectiver la progression du handicap ; on y superpose
 *   classiquement des seuils cliniques repères (EDSS 4 = limitation nette du
 *   périmètre de marche, EDSS 6 = aide à la marche nécessaire).
 *
 * - Épilepsie pharmacorésistante : courbe de fréquence des crises (crises /
 *   mois, normalisée — cf. colonne générée frequence_normalisee_mois dans
 *   epr_frequence_crises) dans le temps. C'est l'équivalent, en épileptologie,
 *   de l'agenda de crises : le suivi se fait par comparaison à la fréquence
 *   de base, avec le seuil "répondeur" à -50% comme repère standard des
 *   essais thérapeutiques et de la pratique clinique (définition ILAE).
 */

function buildPath(pts) {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

/**
 * @param points        [{ date: 'YYYY-MM-DD', value: number }], triés par date
 * @param yMin/yMax     bornes de l'axe Y
 * @param yTicks        graduations à afficher sur l'axe Y
 * @param unit           unité affichée dans les info-bulles / axe
 * @param referenceLines [{ y: number, label: string, color?: string }] — seuils cliniques
 * @param color          couleur de la courbe
 * @param emptyLabel     message si aucun point
 */
export default function LineChartSVG({
  points = [],
  yMin = 0,
  yMax = 10,
  yTicks,
  unit = '',
  referenceLines = [],
  color = 'var(--teal-deep, #0f766e)',
  emptyLabel = 'Aucune mesure disponible pour tracer cette courbe.',
}) {
  const width = 640;
  const height = 220;
  const padL = 40;
  const padR = 16;
  const padT = 14;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const clean = (points || [])
    .filter((p) => p && p.date && p.value !== null && p.value !== undefined)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (clean.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140,
        border: '1px dashed var(--line)', borderRadius: 12, background: 'var(--paper)',
      }}>
        <p className="hint" style={{ margin: 0 }}>{emptyLabel}</p>
      </div>
    );
  }

  const yScale = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xScale = (i) => (clean.length === 1
    ? padL + plotW / 2
    : padL + (i / (clean.length - 1)) * plotW);

  const pts = clean.map((p, i) => ({ x: xScale(i), y: yScale(p.value), raw: p }));
  const ticks = yTicks || [yMin, (yMin + yMax) / 2, yMax];

  const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });

  // N'affiche pas plus de ~7 étiquettes de dates sous l'axe pour rester lisible.
  const labelEvery = Math.max(1, Math.ceil(clean.length / 7));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {/* Grille horizontale + graduations Y */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={yScale(t)} x2={width - padR} y2={yScale(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={padL - 8} y={yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--slate)">
            {t}{unit}
          </text>
        </g>
      ))}

      {/* Seuils cliniques de repère (ex : EDSS 4/6, seuil répondeur -50%) */}
      {referenceLines.map((ref) => (
        <g key={ref.label}>
          <line
            x1={padL} y1={yScale(ref.y)} x2={width - padR} y2={yScale(ref.y)}
            stroke={ref.color || 'var(--amber, #C98A2C)'} strokeWidth={1.2} strokeDasharray="4 4"
          />
          <text x={width - padR} y={yScale(ref.y) - 4} textAnchor="end" fontSize={9.5} fill={ref.color || 'var(--amber, #C98A2C)'} fontWeight={600}>
            {ref.label}
          </text>
        </g>
      ))}

      {/* Axe X */}
      <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="var(--line)" strokeWidth={1} />

      {/* Courbe */}
      <path d={buildPath(pts)} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />

      {/* Points + étiquettes de date */}
      {pts.map((p, i) => (
        <g key={p.raw.date + i}>
          <circle cx={p.x} cy={p.y} r={3.4} fill={color} stroke="var(--card, #fff)" strokeWidth={1.4} />
          <title>{`${fmtDate(p.raw.date)} — ${p.raw.value}${unit}`}</title>
          {(i % labelEvery === 0 || i === pts.length - 1) && (
            <text x={p.x} y={height - padB + 16} textAnchor="middle" fontSize={9.5} fill="var(--slate)">
              {fmtDate(p.raw.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

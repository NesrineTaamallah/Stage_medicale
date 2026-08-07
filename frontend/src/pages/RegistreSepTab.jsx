import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconWave } from '../components/Icons';
import {
  GOUVERNORAT_PALETTE, pctLabel,
  SectionHeading, CardTitle, HeroStatCard, DonutCard, StackedBar, MultiLineChart,
} from '../components/DashboardWidgets';

/**
 * Fenêtre "Registre SEP" — détachée de la Vue d'Ensemble. Reprend tel quel
 * le bloc "3. REGISTRE SEP" de l'ancien OverviewTabClinicien.jsx.
 */
export default function RegistreSepTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/api/clinicien/registre-sep')
      .then((res) => setData(res.data))
      .catch(() => setError('Impossible de charger le registre SEP.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center' }}>Chargement…</p>;
  }
  if (error || !data) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--error)' }}>{error || 'Erreur inattendue.'}</p>;
  }

  const irm = data.activiteIrm;
  const lcr = data.bandesOligoclonales;

  const gouvernoratSegments = data.gouvernoratRepartition.map((g, i) => ({
    label: g.gouvernorat,
    value: g.count,
    color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeading Icon={IconWave} title="Registre SEP" subtitle="Sclérose en plaques pédiatrique" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard label="Délai diagnostic moyen" value={data.delaiDiagnosticMoyen != null ? `${data.delaiDiagnosticMoyen} mois` : '—'} />
        <HeroStatCard label="Poussées (90 derniers jours)" value={data.pousseesRecentes90j} />
        <HeroStatCard label="Sous traitement de fond actif" value={data.traitementsActifs} />
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
          label="Délai moyen avant forme secondairement progressive"
          value={data.delaiConversionSpMois != null ? `${data.delaiConversionSpMois} mois` : '—'}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Répartition des formes évolutives</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.formesEvolutives.map((f, i) => ({ label: f.forme, value: f.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
        </div>
        <DonutCard
          title="Répartition par gouvernorat"
          segments={gouvernoratSegments}
          centerLabel="patients SEP"
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <DonutCard
          title="Sérologie différentielle (dernier prélèvement)"
          segments={(data.serologieDifferentielle || []).map((s, i) => ({ label: s.type, value: s.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="patients testés"
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 400px' }}>
          <CardTitle hint="Moyenne annuelle du Taux Annualisé de Poussées sur la cohorte SEP.">Tendance du TAP (poussées/an)</CardTitle>
          <div style={{ marginTop: 14 }}>
            <MultiLineChart
              data={(data.tapAnnuel || []).map((t) => ({ label: String(t.annee), tap: t.tap_moyen != null ? Number(t.tap_moyen) : null, n: t.nb_patients }))}
              series={[{ key: 'tap', label: 'TAP moyen', color: '#175F69' }]}
            />
          </div>
        </div>
        <div className="card" style={{ flex: '1 1 400px' }}>
          {(() => {
            // CORRECTION : le "dernier" affiché dans le titre doit être le
            // dernier point réellement tracé sur CE graphique (dernier
            // trimestre avec au moins 1 patient), et non un autre agrégat
            // (moyenne du dernier EDSS connu par patient, tous trimestres
            // confondus) qui ne correspondait pas visuellement au dernier
            // point de la courbe et créait une confusion.
            const tendance = data.edssTendance || [];
            const dernierPointValide = [...tendance].reverse().find((e) => e.nb_patients > 0);
            return (
              <CardTitle
                hint={
                  dernierPointValide
                    ? `Score EDSS moyen de la cohorte, par trimestre (24 derniers mois). Dernière valeur : ${Number(dernierPointValide.edss_moyen)} (${dernierPointValide.periode}, sur ${dernierPointValide.nb_patients} patient(s)).`
                    : 'Score EDSS moyen de la cohorte, par trimestre (24 derniers mois). Aucune donnée sur la période.'
                }
              >
                Tendance EDSS (cohorte) — dernier : {dernierPointValide ? Number(dernierPointValide.edss_moyen) : '—'}
              </CardTitle>
            );
          })()}
          <div style={{ marginTop: 14 }}>
            <MultiLineChart
              data={(data.edssTendance || []).map((e) => ({ label: e.periode, edss: e.edss_moyen != null ? Number(e.edss_moyen) : null, n: e.nb_patients }))}
              series={[{ key: 'edss', label: 'EDSS moyen', color: '#C98A2C' }]}
            />
          </div>
        </div>
      </div>

      {/* ---------- Antécédents familiaux et facteurs de risque ----------
          sep_antecedents.consanguinite_parentale était déjà remonté par le
          backend mais jamais affiché ; atcd_familiaux_auto_immuns_neuro
          n'apparaissait nulle part. Pertinents pour le conseil aux familles
          et la vigilance sur le diagnostic différentiel. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Consanguinité parentale"
          value={pctLabel(data.consanguinite?.positifs, data.consanguinite?.total)}
        />
        <HeroStatCard
          label="Antécédents familiaux auto-immuns neuro"
          value={pctLabel(data.atcdFamiliauxAutoImmuns?.positifs, data.atcdFamiliauxAutoImmuns?.total)}
          hint="Utile au diagnostic différentiel (SEP vs autre maladie auto-immune) et au conseil aux familles."
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Impact scolaire/cognitif rapporté"
          value={pctLabel(data.impactScolaireCognitif?.impact_positif, data.impactScolaireCognitif?.total_renseignes)}
          hint="Souvent plus parlant que l'EDSS seul pour le suivi pédiatrique au quotidien."
        />
        <HeroStatCard
          label="Score cognitif moyen"
          value={data.impactScolaireCognitif?.score_cognitif_moyen != null ? data.impactScolaireCognitif.score_cognitif_moyen : '—'}
          hint={`Sur ${data.impactScolaireCognitif?.score_cognitif_nb_evalues ?? 0} patient(s) évalué(s)`}
        />
        <HeroStatCard
          label="Non testables selon l'âge"
          value={data.impactScolaireCognitif?.score_cognitif_non_applicable ?? 0}
          hint="Score cognitif non applicable (trop jeune pour le test)."
        />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle hint="Type du 1er événement clinique, et part avec récupération complète.">Présentation initiale</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {data.presentationInitiale.map((p) => (
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
            <StackedBar segments={data.lignesTherapeutiques.map((l, i) => ({ label: `Ligne ${l.ligne_therapeutique}`, value: l.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
          {/* Observance du traitement de fond actif : une observance
              partielle/absente peut expliquer un échec apparent autrement
              classé à tort comme switch pour inefficacité. */}
          {(data.observanceTherapeutique || []).length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 16, marginBottom: 6 }}>Observance (traitement de fond actif) :</p>
              <div style={{ marginTop: 4 }}>
                <StackedBar segments={data.observanceTherapeutique.map((o, i) => ({ label: o.observance, value: o.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
              </div>
            </>
          )}
          {data.motifsSwitch.length > 0 && (
            <>
              <p className="hint" style={{ marginTop: 16, marginBottom: 6 }}>Motifs de switch les plus fréquents :</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.motifsSwitch.map((m) => (
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
    </div>
  );
}
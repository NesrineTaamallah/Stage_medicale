import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconWave } from '../components/Icons';
import {
  GOUVERNORAT_PALETTE, pctLabel,
  SectionHeading, CardTitle, HeroStatCard, DonutCard, StackedBar, MultiLineChart,
} from '../components/DashboardWidgets';

const STATUT_PALETTE = {
  'Libre de crises': 'var(--success)',
  'Épilepsie active': 'var(--error)',
  'Perdu de vue': 'var(--warning, orange)',
};

/**
 * Fenêtre "Registre EPR" — détachée de la Vue d'Ensemble. Reprend tel quel
 * le bloc "4. REGISTRE EPR" de l'ancien OverviewTabClinicien.jsx.
 */
export default function RegistreEprTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/api/clinicien/registre-epr')
      .then((res) => setData(res.data))
      .catch(() => setError('Impossible de charger le registre EPR.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center' }}>Chargement…</p>;
  }
  if (error || !data) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--error)' }}>{error || 'Erreur inattendue.'}</p>;
  }

  // --- Regroupe etiologieDevenir (liste plate {etiologie, statut, count}) par
  //     étiologie, pour tracer une barre empilée "statut de suivi" par étiologie. ---
  const etiologieGroups = {};
  (data.etiologieDevenir || []).forEach((row) => {
    if (!etiologieGroups[row.etiologie]) etiologieGroups[row.etiologie] = [];
    etiologieGroups[row.etiologie].push({
      label: row.statut,
      value: row.count,
      color: STATUT_PALETTE[row.statut] || 'var(--slate)',
    });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeading Icon={IconWave} title="Registre EPR" subtitle="Épilepsie résistante pédiatrique" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Pharmacorésistance confirmée"
          value={pctLabel(data.pharmacoresistance?.confirmes, data.pharmacoresistance?.total)}
        />
        <HeroStatCard label="Fréquence de crises moyenne" value={data.frequenceCrisesMoyenne != null ? `${data.frequenceCrisesMoyenne} /mois` : '—'} />
        <HeroStatCard label="Âge moyen au début des crises" value={data.ageDebutCrisesMoyenMois != null ? `${data.ageDebutCrisesMoyenMois} mois` : '—'} />
        <HeroStatCard label="Âge moyen au diagnostic pharmacorésistance" value={data.ageDiagnosticPharmacoresistanceMoyenMois != null ? `${data.ageDiagnosticPharmacoresistanceMoyenMois} mois` : '—'} />
        <HeroStatCard label="Durée de suivi moyenne" value={data.dureeSuiviMoyenneMois != null ? `${data.dureeSuiviMoyenneMois} mois` : '—'} />
      </div>

      <div className="card">
        <CardTitle hint="Fréquence de crises moyenne de la cohorte, par trimestre (24 derniers mois).">Tendance de la fréquence de crises</CardTitle>
        <div style={{ marginTop: 14 }}>
          <MultiLineChart
            data={(data.frequenceCrisesTendance || []).map((f) => ({ label: f.periode, frequence: f.frequence_moyenne != null ? Number(f.frequence_moyenne) : null, n: f.nb_patients }))}
            series={[{ key: 'frequence', label: 'Crises / mois (moyenne)', color: '#C1508A' }]}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px' }}>
          <CardTitle>Répartition des étiologies</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.etiologies.map((e, i) => ({ label: e.categorie, value: e.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
        </div>
        <DonutCard
          title="Types de crise (ILAE 2017)"
          segments={data.typesCrise.map((tc, i) => ({ label: tc.type, value: tc.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="épisodes"
        />
      </div>

      {(data.typesAnomalieEeg || []).length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <DonutCard
            title="Types d'anomalies EEG intercritiques (dernier EEG)"
            hint="Détail au-delà du simple Normal/Anormal — utile à la classification syndromique."
            segments={data.typesAnomalieEeg.map((a, i) => ({ label: a.type, value: a.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
            centerLabel="patients"
          />
        </div>
      )}

      {/* ---------- Prise en charge globale EPR ----------
          Exploite des tables déjà saisies (régression développementale,
          bilan pré-chirurgical, bilan neuropsy) mais jamais remontées côté
          clinicien, alors qu'elles sont centrales dans le suivi pédiatrique
          global d'une épilepsie pharmacorésistante. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <HeroStatCard
          label="Régression développementale rapportée"
          value={pctLabel(data.regressionDeveloppementale?.positifs, data.regressionDeveloppementale?.total)}
          hint="Signal d'alerte pédiatrique (encéphalopathie épileptique / étiologie génétique)."
        />
        <HeroStatCard
          label="Éligibles à la chirurgie (parmi évalués)"
          value={pctLabel(data.eligibiliteChirurgicale?.eligibles, data.eligibiliteChirurgicale?.total_evalues)}
          hint="Sur les patients ayant eu un bilan pré-chirurgical."
        />
        <HeroStatCard
          label="TSA / TDAH associés (parmi évalués)"
          value={pctLabel(data.comorbiditesNeuropsy?.troubles_psy_associes, data.comorbiditesNeuropsy?.total_evalues)}
        />
        <HeroStatCard
          label="Troubles du sommeil (parmi évalués)"
          value={pctLabel(data.comorbiditesNeuropsy?.troubles_sommeil, data.comorbiditesNeuropsy?.total_evalues)}
        />
      </div>

      {/* ---------- Historique des antiépileptiques essayés ----------
          Exploite epr_liste_ae au-delà du simple comptage (v_epr_nb_ae) :
          répond à la question la plus concrète du suivi EPR — qu'a-t-on déjà
          essayé, et pourquoi ça a échoué (inefficacité vs effet indésirable) ? */}
      {data.historiqueAe.length > 0 && (
        <div className="card">
          <CardTitle hint="Répartition des motifs d'échec par molécule, toutes cohortes confondues.">Antiépileptiques les plus essayés</CardTitle>
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--slate)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '8px 10px' }}>Molécule</th>
                  <th style={{ padding: '8px 10px' }}>Essais</th>
                  <th style={{ padding: '8px 10px' }}>Échecs — inefficacité</th>
                  <th style={{ padding: '8px 10px' }}>Échecs — effet indésirable</th>
                </tr>
              </thead>
              <tbody>
                {data.historiqueAe.map((ae) => (
                  <tr key={ae.nom_ae} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', color: 'var(--ink)' }}>{ae.nom_ae}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>{ae.total_essais}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--error)' }}>{ae.echecs_inefficacite}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--warning, orange)' }}>{ae.echecs_effet_indesirable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- Devenir par étiologie ----------
          Réutilise analytics.v_epr_cohorte_etiologie (déjà définie dans le
          schéma, jusqu'ici jamais exploitée) : le statut de suivi croisé avec
          l'étiologie principale, pour situer un patient donné par rapport aux
          autres patients de sa catégorie étiologique. */}
      {Object.keys(etiologieGroups).length > 0 && (
        <div className="card">
          <CardTitle hint="Statut de suivi actuel, par catégorie étiologique principale.">Devenir par étiologie</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
            {Object.entries(etiologieGroups).map(([etiologie, segments]) => (
              <div key={etiologie}>
                <p style={{ margin: '0 0 8px', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{etiologie}</p>
                <StackedBar segments={segments} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Génétique ----------
          epr_genetique n'apparaissait jusqu'ici nulle part côté dashboard,
          alors que la classification ACMG est centrale pour l'orientation
          thérapeutique et le conseil génétique en épilepsie pédiatrique. */}
      {data.genetiqueAcmg.length > 0 && (
        <DonutCard
          title="Classification ACMG des variants identifiés"
          hint="Parmi les patients ayant bénéficié d'un test génétique."
          segments={data.genetiqueAcmg.map((g, i) => ({ label: g.classification, value: g.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))}
          centerLabel="variants"
        />
      )}

      {data.evolutionPostChirurgie.length > 0 && (
        <div className="card">
          <CardTitle hint="Patients opérés uniquement — devenir rapporté à la dernière évaluation.">Devenir post-chirurgical</CardTitle>
          <div style={{ marginTop: 16 }}>
            <StackedBar segments={data.evolutionPostChirurgie.map((e, i) => ({ label: e.evolution, value: e.count, color: GOUVERNORAT_PALETTE[i % GOUVERNORAT_PALETTE.length] }))} />
          </div>
        </div>
      )}
    </div>
  );
}

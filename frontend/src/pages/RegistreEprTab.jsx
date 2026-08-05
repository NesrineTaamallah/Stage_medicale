import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconWave } from '../components/Icons';
import {
  GOUVERNORAT_PALETTE, pctLabel,
  SectionHeading, CardTitle, HeroStatCard, DonutCard, StackedBar,
} from '../components/DashboardWidgets';

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

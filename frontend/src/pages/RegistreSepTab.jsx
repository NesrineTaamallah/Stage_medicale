import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconWave } from '../components/Icons';
import {
  GOUVERNORAT_PALETTE, pctLabel,
  SectionHeading, CardTitle, HeroStatCard, DonutCard, StackedBar,
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
  const cons = data.consanguinite;

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
        <HeroStatCard label="Score EDSS moyen (dernière visite)" value={data.edssMoyen != null ? data.edssMoyen : '—'} hint={`Sur ${data.edssNbPatients} patient(s)`} />
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
          label="Consanguinité parentale"
          value={pctLabel(cons?.positifs, cons?.total)}
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
          hint="Registre SEP uniquement — seul registre où ce champ est saisi actuellement."
          segments={gouvernoratSegments}
          centerLabel="patients SEP"
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

import { useState, useEffect } from 'react';
import client from '../api/client';
import { IconFolder, IconAlert } from '../components/Icons';
import { SectionHeading } from '../components/DashboardWidgets';

const REGISTRE_BADGE = {
  SEP: { bg: 'rgba(23,95,105,0.12)', color: '#175F69' },
  EPR: { bg: 'rgba(201,138,44,0.14)', color: '#8A5D14' },
};

function dateLabel(iso) {
  if (!iso) return 'Jamais';
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Fenêtre "Entités Médicales" — jusqu'ici un item de navigation désactivé
 * ('Bientôt disponible'). Sert désormais de fenêtre d'atterrissage pour les
 * cartes d'alerte de la Vue d'Ensemble : chaque carte cliquée fournit un
 * `alertType`, cette fenêtre appelle GET /api/clinicien/entites/alerte/:type
 * et affiche la liste des patients concernés (pas juste le compte).
 *
 * `alertType` / `onConsumed` sont fournis par ClinicienDashboard : une fois
 * la liste affichée, onConsumed() efface le filtre pour que revenir plus
 * tard sur cet onglet sans passer par une carte affiche l'état neutre.
 */
export default function EntitesMedicalesTab({ alertType, onConsumed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!alertType);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!alertType) return;
    setLoading(true);
    setError('');
    client.get(`/api/clinicien/entites/alerte/${alertType}`)
      .then((res) => setData(res.data))
      .catch(() => setError("Impossible de charger la liste des patients pour cette alerte."))
      .finally(() => {
        setLoading(false);
        onConsumed?.();
      });
  }, [alertType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alertType && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionHeading Icon={IconFolder} title="Entités Médicales" subtitle="Listes de patients issues des alertes de suivi" />
        <div style={{
          padding: '40px 20px', textAlign: 'center', color: 'var(--slate)',
          border: '1px dashed var(--border)', borderRadius: 14, background: 'var(--surface)',
        }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Cliquez sur une carte d'alerte dans la Vue d'Ensemble pour afficher ici la liste des patients concernés.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center' }}>Chargement…</p>;
  }
  if (error || !data) {
    return <p className="hint" style={{ padding: '40px 0', textAlign: 'center', color: 'var(--error)' }}>{error || 'Erreur inattendue.'}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeading Icon={IconFolder} title="Entités Médicales" subtitle={data.label} />

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid var(--amber, #C98A2C)' }}>
        <IconAlert size={16} />
        <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
          <strong>{data.total}</strong> patient(s) concerné(s) par « {data.label} ».
        </span>
      </div>

      {data.total === 0 ? (
        <p className="hint" style={{ padding: '20px 0', textAlign: 'center' }}>Aucun patient dans cette liste actuellement.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--slate)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '12px 16px' }}>Pseudonyme</th>
                  <th style={{ padding: '12px 16px' }}>Registre</th>
                  <th style={{ padding: '12px 16px' }}>Dernière information</th>
                  {data.patients.some((p) => p.statut) && <th style={{ padding: '12px 16px' }}>Détail</th>}
                </tr>
              </thead>
              <tbody>
                {data.patients.map((p) => {
                  const badge = REGISTRE_BADGE[p.registre] || { bg: 'var(--line)', color: 'var(--slate)' };
                  return (
                    <tr key={p.pseudonyme} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)' }}>{p.pseudonyme}</td>
                      <td style={{ padding: '11px 16px' }}>
                        <span style={{
                          padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: badge.bg, color: badge.color,
                        }}>
                          {p.registre}
                        </span>
                      </td>
                      <td style={{ padding: '11px 16px', color: 'var(--slate)' }}>
                        {p.derniereInfo ? dateLabel(p.derniereInfo) : 'Jamais renseigné'}
                      </td>
                      {data.patients.some((x) => x.statut) && (
                        <td style={{ padding: '11px 16px', color: 'var(--slate)' }}>{p.statut || '—'}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import client from '../api/client';

/* ---------------------------------------------------------------------- */
/* Fenêtre 4 - Analyse statistique.                                       */
/* Ne connaît AUCUN test spécifique en dur : la liste et les formulaires   */
/* viennent de GET /api/analyses (backend Node -> service Python).        */
/* Ajouter un 9e test SEP ou un 6e test EPR ne touche pas ce fichier :     */
/* il suffit de l'ajouter dans registry.py côté service d'analyse.        */
/* ---------------------------------------------------------------------- */

function ChampFormulaire({ nomChamp, schema, valeur, onChange }) {
  if (schema.type === 'select') {
    return (
      <select value={valeur ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>-- choisir --</option>
        {schema.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  if (schema.type === 'multiselect') {
    const selection = valeur ?? [];
    const toggle = (opt) => {
      onChange(selection.includes(opt) ? selection.filter((o) => o !== opt) : [...selection, opt]);
    };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {schema.options.map((opt) => (
          <label key={opt} style={{
            fontSize: 13, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
            background: selection.includes(opt) ? 'var(--primary-tint)' : 'var(--surface-alt)',
            border: '1px solid var(--border)',
          }}>
            <input type="checkbox" checked={selection.includes(opt)} onChange={() => toggle(opt)}
              style={{ marginRight: 6 }} />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  // number / text par défaut
  return (
    <input
      type={schema.type === 'number' ? 'number' : 'text'}
      value={valeur ?? schema.default ?? ''}
      onChange={(e) => onChange(schema.type === 'number' ? Number(e.target.value) : e.target.value)}
    />
  );
}

function ResultatAnalyse({ resultat }) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {resultat.notes?.length > 0 && (
        <div style={{
          background: 'var(--surface-alt)', borderRadius: 10, padding: '10px 14px',
          fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        }}>
          {resultat.notes.join('\n')}
        </div>
      )}

      {resultat.resume_stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(resultat.resume_stats).map(([cle, val]) => (
            <div key={cle} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '8px 14px', minWidth: 100,
            }}>
              <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' }}>{cle}</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{String(val)}</div>
            </div>
          ))}
        </div>
      )}

      {resultat.tableau && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {Object.keys(resultat.tableau[0] || {}).map((col) => (
                  <th key={col} style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: 6 }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultat.tableau.map((ligne, i) => (
                <tr key={i}>
                  {Object.values(ligne).map((v, j) => (
                    <td key={j} style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>{String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resultat.figures?.map((src, i) => (
        <img key={i} src={src} alt={`figure-${i}`} style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--border)' }} />
      ))}
    </div>
  );
}

export default function AnalyseStatistiqueTab() {
  const [analyses, setAnalyses] = useState([]);
  const [registreActif, setRegistreActif] = useState('SEP');
  const [analyseSelectionnee, setAnalyseSelectionnee] = useState(null);
  const [config, setConfig] = useState({});
  const [resultat, setResultat] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    client.get('/api/analyses')
      .then((res) => setAnalyses(res.data))
      .catch((err) => setErreur(
        err.response?.data?.error || "Impossible de charger la liste des analyses."
      ))
      .finally(() => setChargement(false));
  }, []);

  const choisirAnalyse = useCallback((a) => {
    setAnalyseSelectionnee(a);
    setConfig({});
    setResultat(null);
    setErreur(null);
  }, []);

  const lancer = async () => {
    if (!analyseSelectionnee) return;
    setEnCours(true);
    setErreur(null);
    setResultat(null);
    try {
      const res = await client.post(`/api/analyses/${analyseSelectionnee.id}/run`, config);
      setResultat(res.data);
    } catch (err) {
      setErreur(err.response?.data?.detail || err.response?.data?.error || "Échec de l'analyse.");
    } finally {
      setEnCours(false);
    }
  };

  const analysesDuRegistre = analyses.filter((a) => a.registre === registreActif);

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Colonne gauche : liste des analyses disponibles */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <div style={{
          display: 'flex', gap: 4, marginBottom: 14, padding: 4,
          background: 'var(--surface-alt)', borderRadius: 10, border: '1px solid var(--border)',
        }}>
          {['SEP', 'EPR'].map((r) => {
            const actif = registreActif === r;
            return (
              <button
                key={r}
                onClick={() => { setRegistreActif(r); setAnalyseSelectionnee(null); setResultat(null); }}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 7, border: 'none',
                  background: actif ? 'var(--primary)' : 'transparent',
                  color: actif ? '#fff' : 'var(--ink)',
                  fontWeight: actif ? 700 : 500,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  boxShadow: actif ? '0 1px 4px rgba(0,0,0,0.18)' : 'none',
                }}
              >
                {r}
              </button>
            );
          })}
        </div>

        {chargement && (
          <div style={{ fontSize: 13, opacity: 0.6, padding: 10 }}>Chargement des analyses…</div>
        )}

        {!chargement && erreur && analyses.length === 0 && (
          <div style={{
            fontSize: 13, color: '#DC2626', padding: 10, borderRadius: 8,
            background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
          }}>
            ⚠️ {erreur}
          </div>
        )}

        {!chargement && (!erreur || analyses.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {analysesDuRegistre.map((a) => (
              <button key={a.id} onClick={() => choisirAnalyse(a)} style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                border: analyseSelectionnee?.id === a.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                background: analyseSelectionnee?.id === a.id ? 'var(--primary-tint)' : 'var(--surface)',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{a.titre}</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2, color: 'var(--slate)' }}>{a.description}</div>
              </button>
            ))}
            {analysesDuRegistre.length === 0 && (
              <div style={{ fontSize: 13, opacity: 0.6, padding: 10 }}>
                Aucune analyse {registreActif} disponible pour l'instant.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Colonne droite : formulaire + résultats */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!analyseSelectionnee && !chargement && (
          <div style={{ opacity: 0.6, fontSize: 14 }}>Choisissez une analyse à gauche pour configurer ses paramètres.</div>
        )}

        {analyseSelectionnee && (
          <>
            <h3 style={{ marginTop: 0 }}>{analyseSelectionnee.titre}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
              {Object.entries(analyseSelectionnee.parametres).map(([nomChamp, schema]) => (
                <label key={nomChamp} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {schema.label || nomChamp}
                  <ChampFormulaire
                    nomChamp={nomChamp}
                    schema={schema}
                    valeur={config[nomChamp]}
                    onChange={(v) => setConfig((c) => ({ ...c, [nomChamp]: v }))}
                  />
                </label>
              ))}

              <button onClick={lancer} disabled={enCours} style={{
                marginTop: 6, padding: '10px 16px', borderRadius: 10, border: 'none',
                background: 'var(--primary)', color: '#fff', fontWeight: 600, cursor: 'pointer',
              }}>
                {enCours ? 'Analyse en cours…' : "Lancer l'analyse"}
              </button>
            </div>

            {erreur && (
              <div style={{ marginTop: 14, color: '#DC2626', fontSize: 13 }}>⚠️ {erreur}</div>
            )}
            {resultat && <ResultatAnalyse resultat={resultat} />}
          </>
        )}
      </div>
    </div>
  );
}
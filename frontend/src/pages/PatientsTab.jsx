import { useEffect, useState } from 'react';
import client from '../api/client';
import { IconLock, IconEye, IconSearch, IconAlert, IconFolder, IconDownload } from '../components/Icons';

const TYPE_DOCUMENT_LABELS = {
  visite: 'Visite', admission: 'Admission', prelevement_sang: 'Prélèvement sanguin',
  eeg: 'EEG', emg: 'EMG', irm: 'IRM', autre: 'Autre',
};

const COLUMNS = [
  { key: 'numero_dossier', label: 'N° dossier' },
  { key: 'nom_prenom', label: 'Nom et prénom' },
  { key: 'date_naissance', label: 'Date de naissance' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'origine', label: 'Origine' },
  { key: 'telephone', label: 'Téléphone' },
  { key: 'cin', label: 'CIN' },
  { key: 'num_cnam', label: 'N° CNAM' },
  { key: 'nom_prenom_pere', label: 'Nom et prénom père' },
  { key: 'nom_prenom_mere', label: 'Nom et prénom mère' },
  { key: 'frere', label: 'Frère(s)' },
  { key: 'soeur', label: 'Sœur(s)' },
  { key: 'autre_antecedent', label: 'Autre antécédent' },
];

/** Cellule floutée tant que la ligne n'a pas été déchiffrée côté serveur. */
function BlurCell({ value, revealed }) {
  return (
    <td style={{ padding: '11px 10px', whiteSpace: 'nowrap' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          filter: revealed ? 'none' : 'blur(5px)',
          userSelect: revealed ? 'auto' : 'none',
          transition: 'filter .2s',
        }}
      >
        {revealed ? (value || '—') : '••••••••••'}
      </span>
    </td>
  );
}

export default function PatientsTab() {
  const [rows, setRows] = useState([]); // [{ pseudonyme, createdAt, data?: {...decrypted} }]
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // pseudonyme en attente, ou 'ALL', ou null
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ---- Modale "Détail" : textes/audios/scans associés à un pseudonyme,
  // disponibles dès l'upload même si l'extraction d'entités n'a pas
  // encore été faite (auquel cas les autres colonnes restent vides).
  const [detailPseudonyme, setDetailPseudonyme] = useState(null);
  const [detailDocuments, setDetailDocuments] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    // On liste depuis /api/dossiers (table `patients`) et non /api/coordonnees
    // (table `coordonnee_patient`) : un dossier créé par le wizard "Ajouter
    // un patient" existe immédiatement dans `patients` (ligne stub avec
    // pseudonyme + date_inclusion), mais `coordonnee_patient` ne sera
    // rempli que par une future étape d'extraction d'identité. Si on
    // écoutait /api/coordonnees, les nouveaux dossiers n'apparaîtraient
    // jamais tant que cette étape n'existe pas.
    client.get('/api/dossiers')
      .then((res) => setRows(res.data.map((r) => ({ ...r, data: null }))))
      .catch(() => setError('Impossible de charger la liste des patients.'))
      .finally(() => setLoading(false));
  }, []);

  function openReveal(pseudonyme) {
    setModal(pseudonyme);
    setPassword('');
    setError('');
  }

  function openRevealAll() {
    setModal('ALL');
    setPassword('');
    setError('');
  }

  function closeModal() {
    setModal(null);
    setPassword('');
    setError('');
  }

  function maskRow(pseudonyme) {
    setRows((prev) => prev.map((r) => (r.pseudonyme === pseudonyme ? { ...r, data: null } : r)));
  }

  function maskAll() {
    setRows((prev) => prev.map((r) => ({ ...r, data: null })));
  }

  function openDetail(pseudonyme) {
    setDetailPseudonyme(pseudonyme);
    setDetailDocuments([]);
    setDetailError('');
    setDetailLoading(true);
    client.get(`/api/dossiers/${pseudonyme}/documents`)
      .then((res) => setDetailDocuments(res.data.documents))
      .catch(() => setDetailError('Impossible de charger les documents associés.'))
      .finally(() => setDetailLoading(false));
  }

  function closeDetail() {
    setDetailPseudonyme(null);
    setDetailDocuments([]);
    setDetailError('');
  }

  async function confirmReveal() {
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      if (modal === 'ALL') {
        // Une requête par ligne, avec le même mot de passe déjà saisi une
        // fois côté utilisateur — le serveur re-vérifie quand même à chaque
        // appel (aucune confiance accordée côté client).
        const results = await Promise.all(
          rows.map((r) =>
            client.post('/api/coordonnees/reveal', { pseudonyme: r.pseudonyme, password })
          )
        );
        setRows((prev) => prev.map((r, i) => ({ ...r, data: results[i].data })));
      } else {
        const res = await client.post('/api/coordonnees/reveal', { pseudonyme: modal, password });
        setRows((prev) => prev.map((r) => (r.pseudonyme === modal ? { ...r, data: res.data } : r)));
      }
      closeModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Mot de passe incorrect.');
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = rows.filter((r) => r.pseudonyme.toLowerCase().includes(search.toLowerCase()));
  const allRevealed = rows.length > 0 && rows.every((r) => !!r.data);

  return (
    <div>
      <div style={{
        background: 'var(--card)', borderRadius: 14, border: '1px solid var(--line)', padding: 22,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontFamily: 'var(--font-display)' }}>Patients</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--slate-soft)' }}>
              Les données identifiantes sont floutées tant qu'elles n'ont pas été déverrouillées.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: rows.length === 0 ? 'not-allowed' : 'pointer', opacity: rows.length === 0 ? 0.5 : 1 }}>
              <span style={{ fontSize: 12.5, color: 'var(--slate)', fontWeight: 600 }}>Déchiffrer tout</span>
              <input
                type="checkbox"
                checked={allRevealed}
                disabled={rows.length === 0}
                onChange={(e) => (e.target.checked ? openRevealAll() : maskAll())}
                style={{ width: 'auto' }}
              />
            </label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--slate-soft)' }}>
                <IconSearch size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un pseudonyme..."
                autoComplete="off"
                name="patient-search"
                style={{
                  width: 240, padding: '9px 12px 9px 32px', borderRadius: 10,
                  border: '1.5px solid var(--line)', fontSize: 12.8, background: 'var(--paper)',
                }}
              />
            </div>
          </div>
        </div>

        {loading && <p style={{ fontSize: 13, color: 'var(--slate)' }}>Chargement…</p>}
        {!loading && filtered.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--slate)' }}>Aucun patient trouvé.</p>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8, minWidth: 1500 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--slate)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '11px 10px', position: 'sticky', left: 0, background: 'var(--card)' }}>Pseudonyme</th>
                  {COLUMNS.map((c) => <th key={c.key} style={{ padding: '11px 10px', whiteSpace: 'nowrap' }}>{c.label}</th>)}
                  <th style={{ padding: '11px 10px' }}>Détail</th>
                  <th style={{ padding: '11px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const revealed = !!r.data;
                  return (
                    <tr key={r.pseudonyme} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '11px 10px', fontFamily: 'var(--font-mono)', position: 'sticky', left: 0, background: 'var(--card)' }}>
                        {r.pseudonyme}
                      </td>
                      {COLUMNS.map((c) => (
                        <BlurCell key={c.key} value={r.data?.[c.key]} revealed={revealed} />
                      ))}
                      <td style={{ padding: '11px 10px' }}>
                        <button
                          onClick={() => openDetail(r.pseudonyme)}
                          title="Voir les textes et fichiers (audio/scan) associés"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                            borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card)',
                            color: 'var(--teal-deep)', fontSize: 11.5, fontWeight: 600,
                          }}
                        >
                          <IconFolder size={13} />
                          Détail
                        </button>
                      </td>
                      <td style={{ padding: '11px 10px' }}>
                        <button
                          onClick={() => (revealed ? maskRow(r.pseudonyme) : openReveal(r.pseudonyme))}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                            borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card)',
                            color: 'var(--teal-deep)', fontSize: 11.5, fontWeight: 600,
                          }}
                        >
                          <IconEye size={13} />
                          {revealed ? 'Masquer' : 'Voir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Modale mot de passe ---- */}
      {modal && (
        <div
          onClick={closeModal}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(18,42,48,.55)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--card)', borderRadius: 16, width: 380, maxWidth: '100%',
            padding: '26px 26px 22px', boxShadow: '0 20px 50px -10px rgba(18,42,48,.35)',
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12, background: 'var(--teal-tint)', color: 'var(--teal-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
            }}>
              <IconLock size={20} />
            </div>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontFamily: 'var(--font-display)' }}>Confirmation requise</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--slate)', lineHeight: 1.5 }}>
              Ces données sont sensibles (identité civile du patient). Saisissez votre mot de passe pour les afficher.
            </p>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--paper)', border: '1px solid var(--line)',
              padding: '6px 10px', borderRadius: 8, display: 'inline-block', marginBottom: 16, color: 'var(--teal-deep)',
            }}>
              {modal === 'ALL' ? `Toutes les lignes (${rows.length} patients)` : `Pseudonyme : ${modal}`}
            </div>
            <input
              type="password"
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmReveal()}
              placeholder="Mot de passe"
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 10, border: '1.5px solid var(--line)',
                fontSize: 13.5, background: 'var(--paper)', marginBottom: 8, boxSizing: 'border-box',
              }}
            />
            {error && (
              <p style={{ fontSize: 11.8, color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 5, margin: '0 0 10px' }}>
                <IconAlert size={13} /> {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button onClick={closeModal} style={{
                flex: 1, padding: '9px 14px', borderRadius: 10, border: '1.5px solid var(--line)',
                background: 'var(--card)', color: 'var(--teal-deep)', fontWeight: 600, fontSize: 13,
              }}>
                Annuler
              </button>
              <button onClick={confirmReveal} disabled={submitting} style={{
                flex: 1, padding: '9px 14px', borderRadius: 10, border: 'none',
                background: 'var(--teal)', color: '#fff', fontWeight: 600, fontSize: 13,
                opacity: submitting ? 0.7 : 1,
              }}>
                {submitting ? 'Vérification…' : 'Déverrouiller'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Modale "Détail" : documents bruts associés au pseudonyme ---- */}
      {detailPseudonyme && (
        <div
          onClick={closeDetail}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(18,42,48,.55)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--card)', borderRadius: 16, width: 560, maxWidth: '100%', maxHeight: '80vh',
            overflowY: 'auto', padding: '26px 26px 22px', boxShadow: '0 20px 50px -10px rgba(18,42,48,.35)',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontFamily: 'var(--font-display)' }}>
              Documents associés
            </h3>
            <p style={{
              margin: '0 0 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--teal-deep)',
            }}>
              Pseudonyme : {detailPseudonyme}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--slate-soft)', lineHeight: 1.5 }}>
              Nom, prénom et autres coordonnées restent vides tant que l'extraction d'entités
              n'a pas encore été effectuée pour ce dossier.
            </p>

            {detailLoading && <p style={{ fontSize: 13, color: 'var(--slate)' }}>Chargement…</p>}
            {detailError && (
              <p style={{ fontSize: 11.8, color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconAlert size={13} /> {detailError}
              </p>
            )}
            {!detailLoading && !detailError && detailDocuments.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--slate)' }}>Aucun document associé pour l'instant.</p>
            )}

            {!detailLoading && detailDocuments.map((d) => (
              <div key={d.id} style={{
                border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {TYPE_DOCUMENT_LABELS[d.type_document] || d.type_document}
                    {' · '}
                    {d.type_entree === 'audio' ? 'Audio' : 'Scan'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--slate-soft)' }}>{d.statut}</span>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--slate-soft)' }}>
                  Ajouté le {d.created_at
                    ? new Date(d.created_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                </p>
                {d.texte_transcrit && (
                  <p style={{
                    margin: '0 0 8px', fontSize: 12.5, color: 'var(--slate)', lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {d.texte_transcrit}
                  </p>
                )}
                <a
                  href={`${client.defaults.baseURL || ''}/api/dossiers/documents/${d.id}/fichier`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5,
                    color: 'var(--teal-deep)', fontWeight: 600, textDecoration: 'none',
                  }}
                >
                  <IconDownload size={13} />
                  Télécharger le fichier original {d.nom_fichier_original ? `(${d.nom_fichier_original})` : ''}
                </a>
              </div>
            ))}

            <div style={{ display: 'flex', marginTop: 6 }}>
              <button onClick={closeDetail} style={{
                flex: 1, padding: '9px 14px', borderRadius: 10, border: '1.5px solid var(--line)',
                background: 'var(--card)', color: 'var(--teal-deep)', fontWeight: 600, fontSize: 13,
              }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
import { useEffect, useState } from 'react';
import client from '../api/client';
import { IconLock, IconEye, IconSearch, IconAlert } from '../components/Icons';

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

  useEffect(() => {
    client.get('/api/coordonnees')
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
    </div>
  );
}
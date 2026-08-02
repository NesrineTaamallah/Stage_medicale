import { useState, useEffect, useCallback, useMemo } from 'react';
import client from '../api/client';
import { IconMail, IconUsers, IconCheckCircle } from '../components/Icons';
import Toast from '../components/Toast';

const ROLE_LABELS = { admin: 'Admins', clinicien: 'Cliniciens', chercheur: 'Chercheurs', statisticien: 'Statisticiens' };

/**
 * Onglet "Communications" : permet à un admin (souvent un médecin, pas
 * forcément à l'aise avec l'outil) d'envoyer un email libre — sujet + texte —
 * depuis la plateforme, à un ou plusieurs utilisateurs précis. Demande de
 * l'encadrante : parfois un mail personnalisé est nécessaire en dehors des
 * emails automatiques (mot de passe, rappel).
 */
export default function CommunicationsTab() {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const { data } = await client.get('/admin/users/detailed');
      setUsers(data.filter((u) => u.is_active));
    } catch {
      setToast({ message: 'Erreur de chargement des utilisateurs.', type: 'error' });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filteredUsers = useMemo(
    () => users.filter((u) => u.email.toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );

  function toggleSelected(id) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const recipientSummary = `${selectedIds.length} destinataire(s) sélectionné(s)`;

  function resetForm() {
    setSubject(''); setMessage(''); setSelectedIds([]);
  }

  async function handleSend() {
    setConfirmOpen(false);
    if (!subject.trim() || !message.trim() || selectedIds.length === 0) return;

    setSending(true);
    try {
      const { data } = await client.post('/admin/communications/send', {
        subject: subject.trim(),
        message: message.trim(),
        recipientMode: 'selected',
        userIds: selectedIds,
      });
      setToast({
        message: data.failed > 0
          ? `${data.sent}/${data.total} email(s) envoyé(s), ${data.failed} échec(s).`
          : `Message envoyé à ${data.sent} destinataire(s).`,
        type: data.failed > 0 ? 'error' : 'success',
      });
      resetForm();
    } catch (err) {
      setToast({ message: err.response?.data?.error || "Erreur lors de l'envoi.", type: 'error' });
    } finally {
      setSending(false);
    }
  }

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && selectedIds.length > 0 && !sending;

  return (
    <div>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8, background: 'var(--primary-tint)',
          color: 'var(--primary-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <IconMail size={14} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>Communications</p>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--slate)' }}>
            Envoyer un email personnalisé depuis la plateforme, en dehors des emails automatiques
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 18, alignItems: 'flex-start' }}>
        {/* ---------- Colonne gauche : destinataires ---------- */}
        <div className="card" style={{ flex: '1 1 340px', minWidth: 300 }}>
          <h2 style={{ margin: 0 }}>Destinataires</h2>
          <p className="hint" style={{ marginTop: 4 }}>Sélectionnez les utilisateurs qui recevront ce message.</p>

          <div style={{ marginTop: 14 }}>
            <input
              type="text"
              placeholder="Rechercher par email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{
              marginTop: 10, maxHeight: 320, overflowY: 'auto',
              border: '1px solid var(--line)', borderRadius: 10,
            }}>
              {loadingUsers && <p className="hint" style={{ padding: 12 }}>Chargement...</p>}
              {!loadingUsers && filteredUsers.length === 0 && (
                <p className="hint" style={{ padding: 12 }}>Aucun utilisateur trouvé.</p>
              )}
              {filteredUsers.map((u) => (
                <label
                  key={u.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderBottom: '1px solid var(--line)', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(u.id)}
                    onChange={() => toggleSelected(u.id)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  <span style={{ flex: 1, color: 'var(--ink)' }}>{u.email}</span>
                  <span style={{ fontSize: 11, color: 'var(--slate)' }}>{ROLE_LABELS[u.role] || u.role}</span>
                </label>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span className="hint">{selectedIds.length} sélectionné(s)</span>
                <button
                  type="button"
                  className="secondary"
                  style={{ width: 'auto', padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => setSelectedIds([])}
                >
                  Tout désélectionner
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---------- Colonne droite : message ---------- */}
        <div className="card" style={{ flex: '1 1 400px', minWidth: 320 }}>
          <h2 style={{ margin: 0 }}>Message</h2>
          <p className="hint" style={{ marginTop: 4 }}>
            Le message est inséré tel quel dans un email au format du registre 
          </p>

          <label style={{ marginTop: 14 }}>Sujet</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="ex : Maintenance planifiée ce week-end"
          />

          <label style={{ marginTop: 12 }}>Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Écrivez votre message ici..."
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13.5, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)' }}
          />

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--slate)' }}>
              <IconUsers size={14} /> {recipientSummary}
            </span>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => setConfirmOpen(true)}
              style={{ width: 'auto', padding: '9px 18px' }}
            >
              {sending ? 'Envoi en cours...' : 'Envoyer →'}
            </button>
          </div>
        </div>
      </div>

      {/* ---------- Confirmation avant envoi groupé ---------- */}
      {confirmOpen && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}>
          <div className="modal-panel" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2 style={{ margin: 0 }}>Confirmer l'envoi</h2>
            </div>
            <p style={{ marginTop: 12, fontSize: 13.5, color: 'var(--ink)' }}>
              Envoyer « {subject.trim()} » à <strong>{recipientSummary}</strong> ?
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" className="secondary" style={{ flex: 1 }} onClick={() => setConfirmOpen(false)}>
                Annuler
              </button>
              <button type="button" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={handleSend}>
                <IconCheckCircle size={14} /> Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

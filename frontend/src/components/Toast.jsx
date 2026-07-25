import { useEffect } from 'react';
import { IconCheckCircle, IconAlert, IconX } from './Icons';

/**
 * Notification flottante en haut à droite — pour confirmer une action admin
 * (renvoi de mot de passe, déverrouillage, etc.) sans polluer la mise en page
 * avec un texte permanent. Se ferme seule après quelques secondes ou au clic.
 */
export default function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  const isError = toast.type === 'error';

  return (
    <div className="toast-viewport">
      <div className={`toast${isError ? ' toast-error' : ''}`} role="status" aria-live="polite">
        <span className="icon" style={{ color: isError ? 'var(--error)' : 'var(--success)', marginTop: 1 }}>
          {isError ? <IconAlert size={19} /> : <IconCheckCircle size={19} />}
        </span>
        <p className="toast-message">{toast.message}</p>
        <button type="button" className="toast-close" onClick={onClose} aria-label="Fermer la notification">
          <IconX size={13} />
        </button>
      </div>
    </div>
  );
}
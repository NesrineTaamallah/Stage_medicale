import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import BrandMark from '../components/BrandMark';
import AnalyseStatistiqueTab from './AnalyseStatistiqueTab';
import { IconChart, IconUsers, IconFolder, IconLogout, IconWave } from '../components/Icons';

const SIDEBAR_WIDTH = 248;

const NAV_ITEMS = [
  { key: 'overview', Icon: IconChart, label: "Vue d'Ensemble", disabled: true },
  { key: 'patients', Icon: IconUsers, label: 'Patients', disabled: true },
  { key: 'entites', Icon: IconFolder, label: 'Entités Médicales', disabled: true },
  { key: 'analyses', Icon: IconWave, label: 'Analyse Statistique', disabled: false },
];

/**
 * Extrait un "Prénom Nom" présentable à partir d'un email du type
 * prenom.nom@domaine.tld (format utilisé par tous les comptes du registre).
 * Pas de casse-tête si le format ne matche pas : on retombe sur la partie
 * locale de l'email telle quelle plutôt que d'afficher un email brut.
 */
function displayNameFromEmail(email) {
  if (!email) return 'Clinicien';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/** "Nesrine Taamallah" → "NT", pour l'avatar rond du pied de sidebar. */
function initialsFromName(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Dimanche 2 août 2026" — capitalisée, même format que côté admin. */
function todayFr() {
  const str = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function ClinicienDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('analyses');

  const displayName = displayNameFromEmail(user?.email);

  return (
    <div style={{ minHeight: '100svh', background: 'var(--paper)' }}>
      {/* ---------- Barre latérale gauche ---------- */}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          background: 'linear-gradient(180deg, #16333A, #122A30 70%)',
          display: 'flex',
          flexDirection: 'column',
          height: '100svh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 10,
        }}
      >
        <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BrandMark size={38} />
            <div>
              <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#F1FAFB', margin: 0, lineHeight: 1.25 }}>
                NeuroExo-Predict
              </p>
              <p style={{ fontSize: 11.5, color: '#8FB6BD', margin: 0 }}>
                Registre clinique
              </p>
            </div>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 12px', flex: 1, overflowY: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => !item.disabled && setTab(item.key)}
                disabled={item.disabled}
                title={item.disabled ? 'Bientôt disponible' : undefined}
                style={{
                  width: '100%',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 12px',
                  fontSize: 13.5,
                  fontWeight: 500,
                  textAlign: 'left',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: item.disabled ? '#5C7F86' : (active ? '#F1FAFB' : '#B9D9DE'),
                  boxShadow: 'none',
                  border: 'none',
                  borderLeft: active ? '3px solid var(--highlight)' : '3px solid transparent',
                  borderRadius: 8,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <item.Icon size={16} />
                  {item.label}
                </span>
                {item.disabled && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
                    padding: '2px 6px', borderRadius: 999, background: 'rgba(255,255,255,0.06)',
                    color: '#6E939A', flexShrink: 0,
                  }}>
                    Bientôt
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: 'var(--teal-tint)', color: 'var(--teal-deep)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12.5,
          }}>
            {initialsFromName(displayName)}
          </div>
          <div style={{ lineHeight: 1.25, overflow: 'hidden', flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12.8, fontWeight: 600, color: '#F1FAFB', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayName}
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: '#8FB6BD', wordBreak: 'break-all' }}>
              {user?.email}
            </p>
          </div>
          <button
            onClick={logout}
            title="Déconnexion"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#8FB6BD', width: 30, height: 30, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: 'none', padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(193,80,61,0.18)'; e.currentTarget.style.color = '#F2A392'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8FB6BD'; }}
          >
            <IconLogout size={15} />
          </button>
        </div>
      </aside>

      {/* ---------- Contenu ---------- */}
      <div style={{ marginLeft: SIDEBAR_WIDTH, minWidth: 0 }}>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            background: 'linear-gradient(180deg, #F3FBFD, var(--paper))',
            borderBottom: '1px solid var(--line)',
            padding: '20px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, color: 'var(--ink)' }}>
              Bonjour, {displayName} <span style={{ fontWeight: 400 }}>👋</span>
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--slate)' }}>
              {todayFr()}
            </p>
          </div>

          {/* Rappel visuel explicite : cet espace est réservé aux comptes clinicien. */}
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              background: 'var(--teal-tint)', color: 'var(--teal-deep)',
              fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
              flexShrink: 0, marginTop: 2,
            }}
          >
            <IconWave size={13} />
            Espace Clinicien
          </div>
        </header>

        <div className="dashboard" style={{ maxWidth: 1120 }}>
          {tab !== 'analyses' && (
            <div style={{
              padding: '40px 20px', textAlign: 'center', color: 'var(--slate)',
              border: '1px dashed var(--border)', borderRadius: 14, background: 'var(--surface)',
            }}>
              <p style={{ margin: 0, fontSize: 14 }}>
                Cette section arrive bientôt.
              </p>
            </div>
          )}
          {tab === 'analyses' && <AnalyseStatistiqueTab />}
        </div>
      </div>
    </div>
  );
}
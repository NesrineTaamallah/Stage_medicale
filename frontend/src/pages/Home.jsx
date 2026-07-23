import { useNavigate } from 'react-router-dom';
import EegTrace from '../components/EegTrace';
import { IconShield, IconWave, IconUsers, IconFolder, IconArrowRight } from '../components/Icons';

const FEATURES = [
  {
    Icon: IconShield,
    title: 'Authentification renforcée',
    desc: "Mot de passe + TOTP obligatoire, cookies de session httpOnly, verrouillage automatique après échecs répétés.",
  },
  {
    Icon: IconFolder,
    title: 'Registre structuré',
    desc: "Un dossier par patient, un accès par rôle : clinicien, chercheur ou administrateur, sans chevauchement.",
  },
  {
    Icon: IconWave,
    title: 'Données EEG',
    desc: "Environnement conçu pour l'exploitation de signaux neuro-physiologiques dans le cadre de la recherche NeuroExo.",
  },
  {
    Icon: IconUsers,
    title: 'Traçabilité complète',
    desc: "Chaque action administrative est journalisée : création de comptes, réinitialisations, anomalies détectées.",
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* ---------- En-tête ---------- */}
      <header
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          width: '100%',
          padding: '28px 24px 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 500, color: 'var(--ink)' }}>
          NeuroExo&#8209;Predict
        </span>
        <button
          className="secondary"
          style={{ width: 'auto' }}
          onClick={() => navigate('/login')}
        >
          Connexion
        </button>
      </header>

      {/* ---------- Hero ---------- */}
      <section style={{ padding: '48px 24px 64px' }}>
        <div
          style={{
            maxWidth: 1040,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
            gap: 56,
            alignItems: 'center',
          }}
        >
          <div>
            <p className="eyebrow">Registre clinique — accès professionnel</p>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(32px, 4.2vw, 46px)',
                fontWeight: 500,
                color: 'var(--ink)',
                margin: '0 0 18px',
                lineHeight: 1.12,
                letterSpacing: '-0.5px',
              }}
            >
              Un registre pensé pour la rigueur du diagnostic neuro&#8209;exosquelette.
            </h1>
            <p style={{ fontSize: 15.5, color: 'var(--slate)', lineHeight: 1.65, margin: '0 0 30px', maxWidth: 480 }}>
              NeuroExo‑Predict centralise les dossiers, les signaux EEG et les accès de votre équipe
              clinique et de recherche, avec une authentification à deux facteurs obligatoire pour
              chaque compte.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <button
                style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px' }}
                onClick={() => navigate('/login')}
              >
                Accéder au registre
                <IconArrowRight size={16} color="#fff" />
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--slate-soft)' }}>
                Accès réservé au personnel autorisé
              </span>
            </div>
          </div>

          {/* ---------- Panneau "tracé EEG" (signature) ---------- */}
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              padding: '22px 22px 18px',
              boxShadow: '0 1px 2px rgba(20,40,44,0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 14,
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate-soft)', letterSpacing: 0.4 }}>
                CANAL EEG — DÉMONSTRATION
              </span>
              <span className="badge badge-success">Signal actif</span>
            </div>
            {[0, 1, 2].map((i) => (
              <EegTrace key={i} />
            ))}
            <hr className="hairline" style={{ margin: '4px 0 14px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--slate-soft)' }}>
              <span>Réf. dossier 000&#8209;000</span>
              <span>2FA · TOTP</span>
            </div>
          </div>
        </div>
      </section>

      <hr className="hairline" style={{ maxWidth: 1040, margin: '0 auto', width: 'calc(100% - 48px)' }} />

      {/* ---------- Fonctionnalités ---------- */}
      <section style={{ padding: '56px 24px', flex: 1 }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <p className="eyebrow">Ce que couvre la plateforme</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 0,
              border: '1px solid var(--line)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            {FEATURES.map(({ Icon, title, desc }, i) => (
              <div
                key={title}
                style={{
                  padding: '26px 24px',
                  background: 'var(--card)',
                  borderRight: i % 2 === 0 ? '1px solid var(--line)' : 'none',
                  borderBottom: i < 2 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div
                  className="icon"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 4,
                    background: 'var(--teal-tint)',
                    color: 'var(--teal-deep)',
                    marginBottom: 14,
                  }}
                >
                  <Icon size={17} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, margin: '0 0 6px', color: 'var(--ink)' }}>
                  {title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--slate)', lineHeight: 1.55, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Pied de page ---------- */}
      <footer
        style={{
          borderTop: '1px solid var(--line)',
          padding: '20px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          maxWidth: 1040,
          margin: '0 auto',
          width: 'calc(100% - 48px)',
          fontSize: 12,
          color: 'var(--slate-soft)',
        }}
      >
        <span>© {new Date().getFullYear()} NeuroExo‑Predict</span>
        <span>Registre clinique interne — usage professionnel uniquement</span>
      </footer>
    </div>
  );
}
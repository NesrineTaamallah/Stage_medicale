import { useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { IconShield, IconWave, IconUsers, IconFolder, IconArrowRight, IconLock } from '../components/Icons';

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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--paper)' }}>
      {/* ---------- Barre de navigation ---------- */}
      <header
        style={{
          borderBottom: '1px solid var(--line)',
          background: 'var(--card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark size={32} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              Registre Clinique
            </span>
          </div>

          <nav style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <a href="#fonctionnalites" style={{ fontSize: 13.5, color: 'var(--slate)', textDecoration: 'none', fontWeight: 500 }}>
              Fonctionnalités
            </a>
            <a href="#apropos" style={{ fontSize: 13.5, color: 'var(--slate)', textDecoration: 'none', fontWeight: 500 }}>
              À propos
            </a>
          </nav>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="secondary" style={{ width: 'auto' }} onClick={() => navigate('/login')}>
              Connexion
            </button>
            <button style={{ width: 'auto', margin: 0 }} onClick={() => navigate('/login')}>
              Commencer
            </button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section style={{ padding: '56px 24px 64px' }}>
        <div
          style={{
            maxWidth: 1120,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
            gap: 56,
            alignItems: 'center',
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(34px, 4.4vw, 48px)',
                fontWeight: 800,
                color: 'var(--ink)',
                margin: '0 0 18px',
                lineHeight: 1.1,
                letterSpacing: '-0.6px',
              }}
            >
              Plateforme<br />Médicale Sécurisée
            </h1>
            <p style={{ fontSize: 15.5, color: 'var(--slate)', lineHeight: 1.65, margin: '0 0 30px', maxWidth: 460 }}>
              Registre clinique professionnel avec authentification sécurisée, authentification 2FA
              et gestion administrative complète pour vos données médicales.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                style={{ width: 'auto', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px' }}
                onClick={() => navigate('/login')}
              >
                Se Connecter
                <IconArrowRight size={16} color="#fff" />
              </button>
              <button
                className="secondary"
                style={{ width: 'auto', padding: '13px 22px' }}
                onClick={() => document.getElementById('fonctionnalites')?.scrollIntoView({ behavior: 'smooth' })}
              >
                En Savoir Plus
              </button>
            </div>
          </div>

          {/* ---------- Panneau "Sécurité Maximale" ---------- */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--primary-soft), var(--accent-tint))',
              borderRadius: 20,
              padding: '48px 32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                borderRadius: 20,
                background: 'rgba(255,255,255,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
              }}
            >
              <IconLock size={34} color="var(--primary-deep)" />
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
              Sécurité Maximale
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--slate)', lineHeight: 1.6, margin: 0, maxWidth: 260 }}>
              Vos données sont protégées par les protocoles de sécurité les plus avancés
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Fonctionnalités ---------- */}
      <section id="fonctionnalites" style={{ padding: '16px 24px 64px', flex: 1 }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 30,
              fontWeight: 800,
              textAlign: 'center',
              margin: '0 0 40px',
              color: 'var(--ink)',
            }}
          >
            Fonctionnalités Principales
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 20,
            }}
          >
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="card"
                style={{ padding: '26px 22px' }}
              >
                <div
                  className="icon"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: 'var(--primary-tint)',
                    color: 'var(--primary-deep)',
                    marginBottom: 16,
                  }}
                >
                  <Icon size={19} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15.5, fontWeight: 700, margin: '0 0 6px', color: 'var(--ink)' }}>
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
        id="apropos"
        style={{
          borderTop: '1px solid var(--line)',
          background: 'var(--card)',
          padding: '20px 24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            maxWidth: 1120,
            margin: '0 auto',
            width: '100%',
            fontSize: 12,
            color: 'var(--slate-soft)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>© {new Date().getFullYear()} Registre Clinique — NeuroExo‑Predict</span>
          <span>Registre clinique interne — usage professionnel uniquement</span>
        </div>
      </footer>
    </div>
  );
}

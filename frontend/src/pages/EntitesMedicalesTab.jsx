import { useEffect, useState } from 'react';
import client from '../api/client';
import { SectionHeading } from '../components/DashboardWidgets';
import {
  IconEye, IconPlus, IconSearch, IconX, IconFolder, IconAlert,
  IconUsers, IconHistory, IconActivity, IconTarget, IconHeart, IconWave, IconUpload,
} from '../components/Icons';

const REGISTRE_STYLE = {
  SEP: { bg: 'var(--teal-tint)', fg: 'var(--teal-deep)' },
  EPR: { bg: 'var(--amber-tint)', fg: 'var(--amber)' },
};

function RegistreBadge({ registre }) {
  const style = REGISTRE_STYLE[registre] || { bg: 'var(--line)', fg: 'var(--slate)' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
      borderRadius: 999, background: style.bg, color: style.fg, letterSpacing: 0.3,
    }}>
      {registre}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

function humanizeKey(key) {
  const clean = key.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDate(v);
  return String(v);
}

/** Grille label/valeur "boîte" pour les champs simples (scalaires) d'un objet. */
function FieldsGrid({ entries }) {
  const filtered = entries.filter(([k]) => !['id', 'pseudonyme'].includes(k));
  if (filtered.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 18px' }}>
      {filtered.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--slate)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {humanizeKey(k)}
          </p>
          <div style={{
            padding: '9px 11px', border: '1.5px solid var(--line)', borderRadius: 9,
            background: 'var(--paper)', fontSize: 13.5, color: 'var(--ink)',
          }}>
            {formatValue(v)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Rendu générique et récursif d'un bloc d'entités : champs simples en grille,
 * sous-objets en sous-titre, tableaux répétés (visites, IRM, traitements...)
 * en liste de fiches. Évite de coder en dur chaque champ du schéma clinique,
 * qui évolue encore (cf. corrections successives dans schema_registre.sql).
 */
function SectionContent({ data, depth = 0 }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return <p className="hint" style={{ margin: 0 }}>Aucune donnée extraite pour cette section.</p>;
  }

  const entries = Object.entries(data);
  const simple = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const nestedObjects = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  const nestedArrays = entries.filter(([, v]) => Array.isArray(v));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FieldsGrid entries={simple} />

      {nestedObjects.map(([k, v]) => (
        <div key={k}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{humanizeKey(k)}</p>
          <SectionContent data={v} depth={depth + 1} />
        </div>
      ))}

      {nestedArrays.map(([k, arr]) => (
        <div key={k}>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
            {humanizeKey(k)} <span style={{ color: 'var(--slate-soft)', fontWeight: 500 }}>({arr.length})</span>
          </p>
          {arr.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>Aucun élément.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {arr.map((item, i) => (
                <div key={item.id ?? i} style={{
                  border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--paper)',
                }}>
                  <FieldsGrid entries={Object.entries(item)} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Catégories d'entités, dans l'ordre où elles sont saisies/extraites en pratique
// (cf. brief du stage : identification, antécédents, évolution clinique, imagerie,
// traitements, suivi). "Notes" est ajouté à part — ce n'est pas une entité NER,
// c'est une information libre laissée par le clinicien.
const TABS = [
  { key: 'identification', label: 'Identification', Icon: IconUsers },
  { key: 'antecedents', label: 'Antécédents', Icon: IconHistory },
  { key: 'evolutionClinique', label: 'Évolution clinique', Icon: IconActivity },
  { key: 'imagerie', label: 'Imagerie & examens', Icon: IconTarget },
  { key: 'traitements', label: 'Traitements', Icon: IconHeart },
  { key: 'suivi', label: 'Suivi', Icon: IconWave },
];

/** Barre d'onglets horizontale — même esprit que les sous-onglets d'une fiche patient. */
function SubTabs({ active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', marginBottom: 18,
    }}>
      {TABS.map(({ key, label, Icon }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            style={{
              width: 'auto', margin: 0, padding: '9px 4px', marginRight: 16,
              background: 'transparent', border: 'none', borderRadius: 0, boxShadow: 'none',
              borderBottom: isActive ? '2px solid var(--teal)' : '2px solid transparent',
              color: isActive ? 'var(--teal-deep)' : 'var(--slate)',
              fontSize: 13, fontWeight: isActive ? 700 : 600,
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Modale "Voir" — détail des entités médicales extraites, structurées par catégorie. */
function DossierModal({ pseudonyme, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('identification');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setActiveTab('identification'); // repart sur "Identification" à chaque nouveau dossier ouvert
    client.get(`/api/dossiers/${pseudonyme}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setError('Impossible de charger ce dossier.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pseudonyme]);

  const ident = data?.identification || {};
  // pseudonyme / registre déjà affichés dans l'en-tête de la modale.
  const { pseudonyme: _p, registre: _r, ...identRest } = ident;

  return (
    <div onClick={onClose} className="modal-overlay">
      <div onClick={(e) => e.stopPropagation()} className="modal-panel" style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, background: 'var(--teal-tint)', color: 'var(--teal-deep)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <IconFolder size={18} />
            </div>
            <div>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>
                {pseudonyme}
              </p>
              {ident.registre && <RegistreBadge registre={ident.registre} />}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
            <IconX size={16} />
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {loading && <p className="hint">Chargement du dossier…</p>}
          {error && <p className="error">{error}</p>}

          {!loading && !error && data && (
            <>
              <SubTabs active={activeTab} onChange={setActiveTab} />

              <div style={{ minHeight: 160 }}>
                {activeTab === 'identification' && <FieldsGrid entries={Object.entries(identRest)} />}
                {activeTab !== 'identification' && (
                  <SectionContent data={data[activeTab]} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Modale "Ajouter" — pipeline audio → transcription → pseudonymisation → NER.
 * Non branché pour l'instant (cf. suite du stage) : simple aperçu visuel des
 * étapes, même codage visuel "Bientôt disponible" que le reste du dashboard
 * clinicien (voir NAV_ITEMS dans ClinicienDashboard.jsx).
 */
function AddDossierModal({ onClose }) {
  const steps = [
    { label: 'Audio', hint: 'Enregistrement du compte rendu dicté' },
    { label: 'Transcription', hint: 'Whisper' },
    { label: 'Pseudonymisation', hint: 'AES-256-GCM + HMAC-SHA256' },
    { label: 'Extraction NER', hint: 'Champs structurés injectés en base' },
  ];
  return (
    <div onClick={onClose} className="modal-overlay">
      <div onClick={(e) => e.stopPropagation()} className="modal-panel" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-display)' }}>Ajouter un dossier</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
            <IconX size={16} />
          </button>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>
          Le pipeline complet n'est pas encore branché à cette interface.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {steps.map((s, i) => (
            <div key={s.label} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 10, border: '1px dashed var(--line)', background: 'var(--paper)', opacity: 0.75,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--line)', color: 'var(--slate)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.label}</p>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--slate)' }}>{s.hint}</p>
              </div>
              {i === 0 && <IconUpload size={16} color="var(--slate-soft)" />}
            </div>
          ))}
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16,
          padding: '5px 11px', borderRadius: 999, background: 'var(--line)', color: 'var(--slate)',
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
        }}>
          Bientôt disponible
        </div>

        <button type="button" className="secondary" style={{ marginTop: 18 }} onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}

/**
 * Fenêtre "Entités Médicales" — tableau de tous les dossiers (pseudonyme,
 * registre, dates), "Voir" pour le détail des entités extraites par le NER
 * (par catégorie), "Notes" libres, "Ajouter" (aperçu pipeline, pas encore
 * branché).
 *
 * `alertType` / `onConsumed` sont fournis par ClinicienDashboard : quand on
 * arrive ici via une carte d'alerte de la Vue d'Ensemble, on va chercher la
 * liste des patients concernés par cette alerte (GET
 * /api/clinicien/entites/alerte/:type) et on filtre le tableau sur ces
 * pseudonymes uniquement, avec un bandeau + un bouton pour repasser à la
 * liste complète. onConsumed() efface le filtre côté ClinicienDashboard pour
 * que revenir plus tard sur cet onglet sans passer par une carte affiche la
 * liste complète, pas un filtre périmé.
 */
export default function EntitesMedicalesTab({ alertType, onConsumed }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [viewPseudo, setViewPseudo] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const [alertFilter, setAlertFilter] = useState(null); // Set<pseudonyme> | null
  const [alertLabel, setAlertLabel] = useState('');
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertError, setAlertError] = useState('');

  useEffect(() => {
    client.get('/api/dossiers')
      .then((res) => setRows(res.data))
      .catch(() => setError('Impossible de charger la liste des dossiers.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!alertType) return;
    setAlertLoading(true);
    setAlertError('');
    client.get(`/api/clinicien/entites/alerte/${alertType}`)
      .then((res) => {
        setAlertFilter(new Set((res.data.patients || []).map((p) => p.pseudonyme)));
        setAlertLabel(res.data.label || '');
      })
      .catch(() => setAlertError("Impossible de charger la liste des patients pour cette alerte."))
      .finally(() => {
        setAlertLoading(false);
        onConsumed?.();
      });
  }, [alertType]); // eslint-disable-line react-hooks/exhaustive-deps

  const bySearch = rows.filter((r) => r.pseudonyme.toLowerCase().includes(search.toLowerCase()));
  const filtered = alertFilter ? bySearch.filter((r) => alertFilter.has(r.pseudonyme)) : bySearch;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeading Icon={IconFolder} title="Entités Médicales" subtitle="Dossiers et entités extraites par le NER" />

      {alertLoading && (
        <p className="hint" style={{ margin: 0 }}>Chargement de l'alerte…</p>
      )}
      {alertError && <p className="error" style={{ margin: 0 }}>{alertError}</p>}
      {alertFilter && !alertLoading && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderLeft: '3px solid var(--amber, #C98A2C)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink)' }}>
            <IconAlert size={16} />
            <strong>{alertFilter.size}</strong> patient(s) concerné(s) par « {alertLabel} ».
          </span>
          <button
            type="button"
            className="secondary"
            style={{ width: 'auto', margin: 0, padding: '6px 12px', fontSize: 12 }}
            onClick={() => setAlertFilter(null)}
          >
            Voir tous les dossiers
          </button>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontFamily: 'var(--font-display)' }}>Dossiers</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--slate-soft)' }}>
              Champs structurés extraits par le NER, dossier par dossier.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--slate-soft)' }}>
                <IconSearch size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un pseudonyme..."
                autoComplete="off"
                name="dossier-search"
                style={{ width: 220, padding: '9px 12px 9px 32px', borderRadius: 10, border: '1.5px solid var(--line)', fontSize: 12.8, background: 'var(--paper)' }}
              />
            </div>
            <button
              type="button"
              style={{ width: 'auto', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px' }}
              onClick={() => setShowAdd(true)}
            >
              <IconPlus size={15} color="#fff" />
              Ajouter
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {loading && <p style={{ fontSize: 13, color: 'var(--slate)' }}>Chargement…</p>}
        {!loading && !error && filtered.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--slate)' }}>Aucun dossier trouvé.</p>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.8 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--slate)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '11px 10px' }}>Pseudonyme</th>
                  <th style={{ padding: '11px 10px' }}>Registre</th>
                  <th style={{ padding: '11px 10px' }}>Date d'inclusion</th>
                  <th style={{ padding: '11px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.pseudonyme} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '11px 10px', fontFamily: 'var(--font-mono)' }}>{r.pseudonyme}</td>
                    <td style={{ padding: '11px 10px' }}><RegistreBadge registre={r.registre} /></td>
                    <td style={{ padding: '11px 10px' }}>{fmtDate(r.date_inclusion)}</td>
                    <td style={{ padding: '11px 10px' }}>
                      <button
                        onClick={() => setViewPseudo(r.pseudonyme)}
                        style={{
                          width: 'auto', margin: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                          borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card)',
                          color: 'var(--teal-deep)', fontSize: 11.5, fontWeight: 600,
                        }}
                      >
                        <IconEye size={13} />
                        Voir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewPseudo && (
        <DossierModal pseudonyme={viewPseudo} onClose={() => setViewPseudo(null)} />
      )}
      {showAdd && <AddDossierModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { SectionHeading } from '../components/DashboardWidgets';
import LineChartSVG from '../components/ClinicalChart';
import {
  IconEye, IconPlus, IconSearch, IconX, IconFolder, IconAlert,
  IconUsers, IconHistory, IconActivity, IconTarget, IconHeart, IconWave, IconUpload,
  IconArrowLeft, IconShield, IconGlobe, IconKey, IconRefresh, IconLock, IconEyeOff,
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

/** Barre de complétude compacte pour la liste des dossiers — couleur selon le seuil (rouge < 50%, ambre < 80%, vert >= 80%). */
function CompletudeCell({ value }) {
  const pct = Number.isFinite(value) ? value : 0;
  const color = pct >= 80 ? 'var(--success, #1c7a52)' : pct >= 50 ? 'var(--amber, #c8790f)' : 'var(--error, #c23b4e)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 90 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color, minWidth: 30, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
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

/**
 * Catégories d'entités par registre, une par onglet — reprises telles quelles
 * des tableaux "Question 1 : Typologie des entités médicales à extraire"
 * (Tableau 1 registre SEP, Tableau 2 registre EPR). Chaque `get` va chercher
 * la portion de l'objet renvoyé par GET /api/dossiers/:pseudonyme (voir
 * dossierController.js -> buildEntitesSEP / buildEntitesEPR) correspondant à
 * cette catégorie précise, plutôt que de regrouper plusieurs catégories sous
 * un seul onglet générique "Évolution clinique" / "Imagerie" / "Traitements".
 */
const TABS_SEP = [
  { key: 'identification', label: 'Identification', Icon: IconUsers, group: 'Clinique', get: (d) => stripIdent(d.identification) },
  { key: 'antecedents', label: 'Antécédents', Icon: IconHistory, group: 'Clinique', get: (d) => d.antecedents },
  { key: 'presentation', label: 'Présentation initiale', Icon: IconActivity, group: 'Clinique', get: (d) => d.evolutionClinique?.presentationInitiale },
  { key: 'poussees', label: 'Poussées', Icon: IconAlert, group: 'Clinique', get: (d) => ({ poussees: d.evolutionClinique?.poussees || [] }) },
  { key: 'handicap', label: 'Handicap & évolution', Icon: IconChartIcon, group: 'Clinique', get: (d) => ({ evolution: d.evolutionClinique?.evolution, edssVisites: d.evolutionClinique?.edssVisites || [] }) },
  { key: 'irm', label: 'Imagerie (IRM)', Icon: IconTarget, group: 'Paraclinique', get: (d) => ({ irm: d.imagerie?.irm || [] }) },
  { key: 'biologie', label: 'Biologie / LCR', Icon: IconShield, group: 'Paraclinique', get: (d) => ({ biologieLcr: d.imagerie?.biologieLcr || [] }) },
  { key: 'pe', label: 'Potentiels évoqués', Icon: IconWave, group: 'Paraclinique', get: (d) => ({ potentielsEvoques: d.imagerie?.potentielsEvoques || [] }) },
  { key: 'traitement', label: 'Traitement de fond', Icon: IconHeart, group: 'Traitement', get: (d) => ({ traitementFond: d.traitements?.traitementFond || [] }) },
  { key: 'suivi', label: 'Suivi', Icon: IconRefresh, group: 'Suivi', get: (d) => d.suivi },
];

const TABS_EPR = [
  { key: 'identification', label: 'Identification', Icon: IconUsers, group: 'Clinique', get: (d) => stripIdent(d.identification) },
  { key: 'antecedents', label: 'Antécédents', Icon: IconHistory, group: 'Clinique', get: (d) => d.antecedents },
  { key: 'semiologie', label: 'Sémiologie critique', Icon: IconActivity, group: 'Clinique', get: (d) => ({ typeCrise: d.evolutionClinique?.typeCrise || [], frequenceCrises: d.evolutionClinique?.frequenceCrises || [] }) },
  { key: 'examen', label: 'Examen', Icon: IconEye, group: 'Clinique', get: (d) => ({ examen: d.evolutionClinique?.examen || [] }) },
  { key: 'etiologie', label: 'Étiologie (ILAE)', Icon: IconKey, group: 'Clinique', get: (d) => ({ etiologie: d.evolutionClinique?.etiologie || [] }) },
  { key: 'regression', label: 'Régression développementale', Icon: IconAlert, group: 'Clinique', get: (d) => d.evolutionClinique?.regressionDeveloppementale },
  { key: 'eeg', label: 'EEG', Icon: IconWave, group: 'Paraclinique', get: (d) => ({ eeg: d.imagerie?.eeg || [] }) },
  { key: 'imagerie', label: 'Imagerie cérébrale', Icon: IconTarget, group: 'Paraclinique', get: (d) => ({ imagerie: d.imagerie?.imagerie || [] }) },
  { key: 'genetique', label: 'Génétique', Icon: IconGlobe, group: 'Paraclinique', get: (d) => ({ genetique: d.imagerie?.genetique || [] }) },
  { key: 'pharmacoresistance', label: 'Pharmacorésistance', Icon: IconShield, group: 'Traitement', get: (d) => ({ listeAe: d.traitements?.listeAe || [] }) },
  { key: 'chirurgie', label: 'Bilan pré-chir. & chirurgie', Icon: IconChartIcon, group: 'Traitement', get: (d) => ({ bilanPrechirurgical: d.traitements?.bilanPrechirurgical || [], chirurgie: d.traitements?.chirurgie || [] }) },
  { key: 'alternatives', label: 'Alternatives thérapeutiques', Icon: IconRefresh, group: 'Traitement', get: (d) => ({ alternatives: d.traitements?.alternatives || [] }) },
  { key: 'multidisciplinaire', label: 'Bilan multidisciplinaire', Icon: IconHeart, group: 'Suivi', get: (d) => ({ bilanOrthophonique: d.suivi?.bilanOrthophonique || [], bilanNeuropsy: d.suivi?.bilanNeuropsy || [], bilanErgotherapique: d.suivi?.bilanErgotherapique || [] }) },
  { key: 'suivi', label: 'Suivi', Icon: IconRefresh, group: 'Suivi', get: (d) => ({ statutDernierSuivi: d.suivi?.statut_dernier_suivi, dureeSuiviMois: d.suivi?.duree_suivi_mois }) },
];

// Ordre d'affichage des groupes dans la sidebar (accordéon).
const GROUP_ORDER = ['Clinique', 'Paraclinique', 'Traitement', 'Suivi'];

// IconChart n'est volontairement pas importé sous ce nom pour éviter tout
// conflit avec un usage futur de IconActivity ; petit alias local.
function IconChartIcon(props) { return <IconTarget {...props} />; }

function stripIdent(ident) {
  if (!ident) return ident;
  const { pseudonyme: _p, registre: _r, ...rest } = ident;
  return rest;
}

/** Barre d'onglets horizontale, groupée par famille clinique (séparateur discret entre groupes) — remplace la liste latérale, une seule source de navigation. */
function HorizontalNav({ tabs, active, onChange }) {
  const byGroup = GROUP_ORDER
    .map((g) => ({ group: g, items: tabs.filter((t) => t.group === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
      borderBottom: '1.5px solid var(--line)', marginBottom: 18, paddingBottom: 2,
    }}>
      {byGroup.map(({ group, items }, gi) => (
        <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {gi > 0 && (
            <span style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 8px' }} />
          )}
          {items.map(({ key, label, Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                title={group}
                style={{
                  width: 'auto', margin: 0, padding: '9px 12px 11px',
                  background: 'transparent', border: 'none', borderRadius: 0, boxShadow: 'none',
                  borderBottom: isActive ? '2.5px solid var(--teal)' : '2.5px solid transparent',
                  color: isActive ? 'var(--teal-deep)' : 'var(--slate)',
                  fontSize: 12.5, fontWeight: isActive ? 700 : 600, whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Courbe de suivi, propre à chaque pathologie — affichée en tête de l'onglet
 * "Suivi", là où le clinicien s'attend à voir la trajectoire du patient plutôt
 * qu'un simple tableau de champs :
 *
 * - SEP : courbe EDSS dans le temps (une mesure par visite, sep_edss_visites).
 *   Seuils repères EDSS 4 (limitation nette du périmètre de marche sans aide)
 *   et EDSS 6 (aide à la marche unilatérale nécessaire) — les deux jalons
 *   cliniques classiques utilisés pour discuter la trajectoire avec la famille.
 *
 * - EPR : courbe de fréquence des crises dans le temps (crises/mois normalisé,
 *   epr_frequence_crises.frequence_normalisee_mois). Seuil "répondeur" à -50%
 *   par rapport à la fréquence de base (1ère mesure disponible) — définition
 *   standard utilisée en épileptologie pour juger l'efficacité d'un traitement.
 */
function SuiviChart({ registre, data }) {
  if (registre === 'EPR') {
    const rows = data.evolutionClinique?.frequenceCrises || [];
    const points = rows
      .filter((r) => r.frequence_normalisee_mois !== null && r.frequence_normalisee_mois !== undefined)
      .map((r) => ({ date: r.date_rapport, value: Number(r.frequence_normalisee_mois) }));
    const baseline = points.length > 0 ? points[0].value : null;
    const yMax = Math.max(4, ...points.map((p) => p.value), baseline ? baseline * 1.1 : 0);

    return (
      <div style={{ marginBottom: 22 }}>
        <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
          Fréquence des crises dans le temps (crises / mois, normalisée)
        </p>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Indicateur de suivi standard en épileptologie — comparaison à la fréquence de base pour juger la réponse thérapeutique (seuil « répondeur » : réduction ≥ 50 %).
        </p>
        <LineChartSVG
          points={points}
          yMin={0}
          yMax={Math.ceil(yMax)}
          unit="/mois"
          color="var(--amber, #c8790f)"
          referenceLines={baseline ? [
            { y: baseline, label: `Fréquence de base (${baseline}/mois)`, color: 'var(--slate)' },
            { y: baseline / 2, label: 'Seuil répondeur (-50 %)', color: 'var(--error, #c23b4e)' },
          ] : []}
          emptyLabel="Aucune fréquence de crises rapportée pour ce patient."
        />
      </div>
    );
  }

  const rows = data.evolutionClinique?.edssVisites || [];
  const points = rows
    .filter((r) => r.score_edss !== null && r.score_edss !== undefined)
    .map((r) => ({ date: r.date_visite, value: Number(r.score_edss) }));

  return (
    <div style={{ marginBottom: 22 }}>
      <p style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
        Score EDSS dans le temps (échelle de handicap, 0–10)
      </p>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Indicateur de suivi standard en neurologie de la SEP — un score par visite, avec les jalons cliniques repères EDSS 4 et EDSS 6.
      </p>
      <LineChartSVG
        points={points}
        yMin={0}
        yMax={10}
        yTicks={[0, 2, 4, 6, 8, 10]}
        unit=""
        color="var(--teal-deep, #145aa3)"
        referenceLines={[
          { y: 4, label: 'EDSS 4 — périmètre de marche limité', color: 'var(--amber, #c8790f)' },
          { y: 6, label: 'EDSS 6 — aide à la marche nécessaire', color: 'var(--error, #c23b4e)' },
        ]}
        emptyLabel="Aucun score EDSS enregistré pour ce patient."
      />
    </div>
  );
}

/**
 * Vue "Dossier" pleine page — remplace l'ancienne modale, trop étroite pour
 * accueillir un onglet par catégorie clinique. Reprend l'esprit de la maquette
 * fiche patient (bandeau patient à gauche, onglets + contenu à droite, sur
 * toute la largeur disponible) plutôt qu'un panneau centré à largeur fixe.
 */
/**
 * Nom & prénom en clair dans la fiche dossier — pour que le médecin identifie
 * son patient sans quitter cette page pour l'onglet "Identités patients".
 * Réutilise EXACTEMENT le même mécanisme que cet onglet (POST
 * /api/coordonnees/reveal, re-confirmation du mot de passe du clinicien
 * connecté, accès journalisé côté serveur) : le nom reste flouté/masqué tant
 * que ce n'est pas confirmé, il n'est jamais renvoyé "en clair" par défaut
 * avec le reste du dossier.
 */
function IdentityReveal({ pseudonyme }) {
  const [nom, setNom] = useState(null); // null = pas encore déverrouillé
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await client.post('/api/coordonnees/reveal', { pseudonyme, password });
      setNom(res.data.nom_prenom || 'Non renseigné');
      setOpen(false);
      setPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Mot de passe incorrect.');
    } finally {
      setSubmitting(false);
    }
  }

  if (nom) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{nom}</p>
        <button
          type="button"
          onClick={() => setNom(null)}
          title="Masquer le nom"
          style={{ width: 'auto', margin: 0, padding: 4, background: 'transparent', border: 'none', boxShadow: 'none', color: 'var(--slate-soft)' }}
        >
          <IconEyeOff size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(''); }}
        style={{
          width: 'auto', margin: 0, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
          borderRadius: 8, border: '1.5px dashed var(--line)', background: 'var(--paper)',
          color: 'var(--slate)', fontSize: 11.5, fontWeight: 600,
        }}
      >
        <IconLock size={12} />
        Afficher nom &amp; prénom
      </button>

      {open && (
        <div style={{
          marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p className="hint" style={{ margin: 0, fontSize: 11 }}>
            Confirmez votre mot de passe pour déverrouiller l'identité — accès journalisé.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
            placeholder="Mot de passe"
            autoComplete="current-password"
            style={{ padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--line)', fontSize: 12.5, background: 'var(--card)' }}
          />
          {error && <p className="error" style={{ margin: 0, fontSize: 11 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={confirm}
              disabled={submitting || !password}
              style={{ width: 'auto', margin: 0, padding: '6px 12px', fontSize: 11.5 }}
            >
              {submitting ? 'Vérification…' : 'Confirmer'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => { setOpen(false); setPassword(''); setError(''); }}
              style={{ width: 'auto', margin: 0, padding: '6px 12px', fontSize: 11.5 }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Résumé rapide affiché sous l'identité du patient dans la sidebar : les 1-2
 * chiffres qu'un clinicien regarde en premier avant même d'ouvrir un onglet
 * (dernier EDSS pour la SEP, dernière fréquence de crises pour l'EPR). Évite
 * que la sidebar ne soit qu'une redite de la navigation.
 */
function QuickStats({ registre, data }) {
  if (registre === 'EPR') {
    const rows = data.evolutionClinique?.frequenceCrises || [];
    const last = rows[rows.length - 1];
    const statut = data.suivi?.statut_dernier_suivi;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
          <span>Dernière fréquence</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {last ? `${formatValue(last.frequence_normalisee_mois)}/mois` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
          <span>Statut au dernier suivi</span>
          <span style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'right' }}>{formatValue(statut)}</span>
        </div>
      </div>
    );
  }
  const edss = data.evolutionClinique?.edssVisites || [];
  const lastEdss = edss[edss.length - 1];
  const statut = data.suivi?.statut_dernier_suivi;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
        <span>Dernier EDSS</span>
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{lastEdss ? formatValue(lastEdss.score_edss) : '—'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
        <span>Statut au dernier suivi</span>
        <span style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'right' }}>{formatValue(statut)}</span>
      </div>
    </div>
  );
}

function DossierView({ pseudonyme, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('identification');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setActiveTab('identification');
    client.get(`/api/dossiers/${pseudonyme}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch(() => { if (!cancelled) setError('Impossible de charger ce dossier.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pseudonyme]);

  const registre = data?.identification?.registre;
  const tabs = useMemo(() => (registre === 'EPR' ? TABS_EPR : TABS_SEP), [registre]);
  const activeDef = tabs.find((t) => t.key === activeTab) || tabs[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button
        type="button"
        className="secondary"
        style={{ width: 'auto', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 12.5 }}
        onClick={onBack}
      >
        <IconArrowLeft size={14} />
        Retour aux dossiers
      </button>

      {loading && <p className="hint">Chargement du dossier…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr', gap: 20, alignItems: 'start' }}>
          {/* Bandeau patient, à gauche — identité + chiffres clés uniquement (la navigation par catégories est passée en horizontal, plus de doublon ici) */}
          <div className="card" style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 11, background: 'var(--teal-tint)', color: 'var(--teal-deep)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <IconFolder size={19} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', wordBreak: 'break-all' }}>
                  {pseudonyme}
                </p>
                {registre && <RegistreBadge registre={registre} />}
              </div>
            </div>

            <IdentityReveal pseudonyme={pseudonyme} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
                <span>Date d'inclusion</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{fmtDate(data.identification?.date_inclusion)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--slate)' }}>
                <span>Âge</span>
                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{formatValue(data.identification?.age)}</span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--slate)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Suivi en un coup d'œil
              </p>
              <QuickStats registre={registre} data={data} />
            </div>
          </div>

          {/* Contenu — pleine largeur restante : onglets horizontaux (seule navigation par catégories) + contenu de la catégorie active */}
          <div className="card" style={{ minHeight: 420 }}>
            <HorizontalNav tabs={tabs} active={activeTab} onChange={setActiveTab} />
            <h3 style={{ margin: '0 0 14px', fontSize: 15, fontFamily: 'var(--font-display)' }}>{activeDef.label}</h3>
            {activeTab === 'suivi' && <SuiviChart registre={registre} data={data} />}
            <SectionContent data={activeDef.get(data)} />
          </div>
        </div>
      )}
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

  // Dossier ouvert -> vue pleine page (plus de modale étroite), le reste
  // (liste + recherche + alertes) reste monté en arrière-plan.
  if (viewPseudo) {
    return <DossierView pseudonyme={viewPseudo} onBack={() => setViewPseudo(null)} />;
  }

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
                  <th style={{ padding: '11px 10px' }}>Dernière visite</th>
                  <th style={{ padding: '11px 10px' }}>Complétude</th>
                  <th style={{ padding: '11px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.pseudonyme} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '11px 10px', fontFamily: 'var(--font-mono)' }}>{r.pseudonyme}</td>
                    <td style={{ padding: '11px 10px' }}><RegistreBadge registre={r.registre} /></td>
                    <td style={{ padding: '11px 10px' }}>{fmtDate(r.date_inclusion)}</td>
                    <td style={{ padding: '11px 10px' }}>{fmtDate(r.derniere_visite)}</td>
                    <td style={{ padding: '11px 10px' }}><CompletudeCell value={r.completude} /></td>
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

      {showAdd && <AddDossierModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
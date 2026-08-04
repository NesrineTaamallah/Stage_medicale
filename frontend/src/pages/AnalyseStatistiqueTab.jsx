import { useState, useEffect, useCallback, useMemo } from 'react';
import client from '../api/client';
import {
  IconWave, IconActivity, IconChart, IconAlert, IconCheckCircle,
  IconRefresh, IconArrowRight, IconArrowLeft,
} from '../components/Icons';
// Photos des deux registres. Copier les fichiers depuis
// C:\Users\nesri\OneDrive\Desktop\etape1-security\images\ vers
// frontend/src/assets/pathologies/ (mêmes noms) : Vite les intègre au
// build comme n'importe quel import JS, pas besoin de les servir à part.
import imgSEP from '../assets/pathologies/SEP.avif';
import imgEPR from '../assets/pathologies/EPR.jpg';

/* ---------------------------------------------------------------------- */
/* Fenêtre 4 - Analyse statistique.                                       */
/* Ne connaît AUCUN test spécifique en dur : la liste et les formulaires   */
/* viennent de GET /api/analyses (backend Node -> service Python).        */
/* Ajouter un 9e test SEP ou un 6e test EPR ne touche pas ce fichier :     */
/* il suffit de l'ajouter dans registry.py côté service d'analyse.        */
/*                                                                          */
/* Parcours en 3 étapes pour rester lisible pour un clinicien non-technique:*/
/*   1) choix du registre (SEP / EPR), avec un résumé général              */
/*   2) liste des tests de ce registre, chacun avec son "but" en une ligne */
/*   3) formulaire de paramètres + résultats du test choisi                */
/* Seuls registreActif / analyseSelectionnee pilotent l'étape affichée :   */
/* aucun état dupliqué à synchroniser.                                     */
/*                                                                          */
/* Notes de charte : cette page réutilise exactement les tokens définis    */
/* dans App.css (--card, --paper, --line, --primary, --slate, ...). Les    */
/* anciennes variables --surface / --surface-alt / --border n'existent     */
/* nulle part ailleurs dans l'app : elles retombaient sur des valeurs      */
/* par défaut du navigateur, d'où le rendu "plat" précédent.               */
/* ---------------------------------------------------------------------- */

/* Descriptif général par registre : rédigé ici (texte produit), les
 * descriptions par test restent celles renvoyées par l'API. */
const REGISTRES = {
  SEP: {
    label: 'SEP',
    nomComplet: 'Sclérose en plaques pédiatrique',
    Icon: IconWave,
    image: imgSEP,
    accent: 'var(--teal)',
    accentTint: 'var(--teal-tint)',
    accentDeep: 'var(--teal-deep)',
    resume: "Analyses portant sur le diagnostic et le suivi de la SEP pédiatrique : délai diagnostique et pronostic (score EDSS), fréquence des poussées, charge lésionnelle à l'IRM, marqueurs du LCR (bandes oligoclonales, index IgG) et facteurs cliniques associés à la forme évolutive.",
  },
  EPR: {
    label: 'EPR',
    nomComplet: 'Épilepsie pharmacorésistante pédiatrique',
    Icon: IconActivity,
    image: imgEPR,
    accent: 'var(--violet)',
    accentTint: 'var(--violet-tint)',
    accentDeep: 'var(--violet-deep)',
    resume: "Analyses portant sur l'étiologie et l'évolution de l'épilepsie pharmacorésistante pédiatrique : survie sans pharmacorésistance selon l'étiologie, régression étiologie/pharmacorésistance, et comparaison des types de crise (classification ILAE 2017).",
  },
};

function SectionHeading({ Icon, title, subtitle, accent, accentTint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, background: accentTint || 'var(--primary-tint)',
        color: accent || 'var(--primary-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={15} />
      </div>
      <div>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--ink)', letterSpacing: -0.1 }}>{title}</p>
        {subtitle && <p style={{ margin: 0, fontSize: 12, color: 'var(--slate)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

/** Étape 1 — grande carte de sélection d'un registre, avec photo,
 * résumé en clair et nombre de tests disponibles. */
function CarteRegistre({ config, nbTests, onClick }) {
  const { label, nomComplet, Icon, image, accent, accentTint, accentDeep, resume } = config;
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', margin: 0, padding: 0, cursor: 'pointer', overflow: 'hidden',
        background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
        boxShadow: '0 1px 2px rgba(17, 24, 39, 0.03)', transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 10px 24px -10px rgba(17, 24, 39, 0.18)';
        e.currentTarget.style.borderColor = accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(17, 24, 39, 0.03)';
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
    >
      <div style={{ background: accentTint }}>
        <img
          src={image}
          alt={`Illustration clinique — ${nomComplet}`}
          className="pathology-photo"
        />
      </div>
      <div style={{ padding: '18px 22px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{

            width: 26, height: 26, borderRadius: 7, background: accentTint, color: accentDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon size={14} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
          <span style={{ fontSize: 12.5, color: 'var(--slate)' }}>— {nomComplet}</span>
        </div>
        <p style={{ margin: '2px 0 16px', fontSize: 13, lineHeight: 1.6, color: 'var(--slate)' }}>{resume}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
            color: accentDeep, background: accentTint, borderRadius: 999, padding: '4px 11px',
          }}>
            {nbTests} test{nbTests > 1 ? 's' : ''} disponible{nbTests > 1 ? 's' : ''}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: accentDeep }}>
            Explorer <IconArrowRight size={14} />
          </span>
        </div>
      </div>
    </button>
  );
}

function BoutonRetour({ onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 'auto', margin: '0 0 16px', padding: '7px 12px', borderRadius: 9, border: '1px solid var(--line)',
      background: 'var(--card)', color: 'var(--slate)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <IconArrowLeft size={13} /> {children}
    </button>
  );
}

function ChampFormulaire({ schema, valeur, onChange }) {
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
        {schema.options.map((opt) => {
          const actif = selection.includes(opt);
          return (
            <label key={opt} style={{
              fontSize: 12.5, fontWeight: 500, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease',
              background: actif ? 'var(--primary-tint)' : 'var(--paper)',
              color: actif ? 'var(--primary-deep)' : 'var(--slate)',
              border: `1px solid ${actif ? 'var(--primary-soft)' : 'var(--line)'}`,
            }}>
              <input type="checkbox" checked={actif} onChange={() => toggle(opt)}
                style={{ width: 'auto', margin: 0, accentColor: 'var(--primary)' }} />
              {opt}
            </label>
          );
        })}
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

/* ---------------------------------------------------------------------- */
/* Interprétation "brute" des notes (stdout capturé)                       */
/* ---------------------------------------------------------------------- */
/* Les 12 scripts non encore refactorés (voir script_runner.py) renvoient   */
/* tout dans `notes` : un dump du print() console d'origine, avec des       */
/* bannières "====", des sous-titres "--- ... ---", des tableaux           */
/* pandas.to_string() alignés par espaces, des lignes [ATTENTION ...] et    */
/* des phrases d'interprétation "-> ...". Ce parseur reconstruit une        */
/* structure (titres / sous-titres / tableaux / alertes / citations /      */
/* texte) SANS toucher aux scripts originaux : il lit juste le texte.       */

const LIGNE_BANNIERE = /^[=]{8,}\s*$/;
const LIGNE_TIRETS = /^-{3,}\s*(.+?)\s*-{3,}$/;
const TOKEN_VALIDE = /^[A-Za-zÀ-ÿ0-9_.\-+%éèêàùç]+$/;

function estLigneDeTableau(ligne) {
  const t = ligne.trim();
  if (!t) return false;
  if (/[:,()]/.test(t)) return false; // ponctuation typique des phrases
  const tokens = t.split(/\s{1,}/).filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.every((tok) => TOKEN_VALIDE.test(tok));
}

function decouperLigneTableau(ligne) {
  return ligne.trim().split(/\s{1,}/).filter(Boolean);
}

/** Regroupe des lignes consécutives "tableau-compatibles" en un bloc
 * { entetes: [...], lignes: [[...]] }. Gère le cas fréquent où pandas
 * imprime une colonne d'index sans en-tête (une valeur de plus par ligne
 * de données que dans l'en-tête). */
function construireTableau(lignesBrutes) {
  const entetes = decouperLigneTableau(lignesBrutes[0]);
  const corps = lignesBrutes.slice(1).map(decouperLigneTableau);
  const decalage = corps.length && corps[0].length === entetes.length + 1 ? 1 : 0;
  return {
    entetes: decalage ? ['#', ...entetes] : entetes,
    lignes: corps.map((r) => (decalage ? r : r.slice(0, entetes.length))),
  };
}

function classifierLigne(ligne) {
  const t = ligne.trim();
  if (!t) return { type: 'vide' };
  if (/^\[?ATTENTION/i.test(t) || /^⚠/.test(t)) return { type: 'alerte', texte: t.replace(/^\[|\]$/g, '') };
  if (/^->/.test(t)) return { type: 'citation', texte: t.replace(/^->\s*/, '') };
  if (/^✅/.test(t)) return { type: 'ok', texte: t.replace(/^✅\s*/, '') };
  if (/^📝/.test(t) || /^ℹ/.test(t)) return { type: 'info', texte: t.replace(/^📝\s*|^ℹ\s*/, '') };
  return { type: 'texte', texte: t };
}

/** Cœur du parseur : transforme le tableau de lignes `notes` en une liste
 * de blocs typés, prêts à être rendus. */
function parseNotes(notes) {
  const lignes = (notes || []).flatMap((l) => String(l).split('\n'));
  const blocs = [];
  let i = 0;
  let dernierGraphiqueNomme = null;

  while (i < lignes.length) {
    const ligne = lignes[i];

    // Bannière "====...====\nTITRE\n====...====" (1 ou 2 lignes de titre)
    if (LIGNE_BANNIERE.test(ligne)) {
      let j = i + 1;
      const titreLignes = [];
      while (j < lignes.length && !LIGNE_BANNIERE.test(lignes[j]) && titreLignes.length < 3) {
        if (lignes[j].trim()) titreLignes.push(lignes[j].trim());
        j++;
      }
      if (j < lignes.length && LIGNE_BANNIERE.test(lignes[j]) && titreLignes.length > 0) {
        const titre = titreLignes.join(' — ');
        blocs.push({
          type: 'titre',
          niveau: /^ETAPE\b/i.test(titre) ? 2 : 1,
          texte: titre,
        });
        i = j + 1;
        continue;
      }
    }

    // Sous-titre encadré par des tirets : "--- texte ---"
    const matchTirets = ligne.trim().match(LIGNE_TIRETS);
    if (matchTirets) {
      blocs.push({ type: 'titre', niveau: 3, texte: matchTirets[1] });
      i++;
      continue;
    }

    // Bloc de tableau : lignes consécutives compatibles (>= 2, dont un en-tête)
    if (estLigneDeTableau(ligne)) {
      const groupe = [ligne];
      let j = i + 1;
      while (j < lignes.length && estLigneDeTableau(lignes[j])) {
        groupe.push(lignes[j]);
        j++;
      }
      if (groupe.length >= 2) {
        blocs.push({ type: 'tableau', ...construireTableau(groupe) });
        i = j;
        continue;
      }
    }

    // Nom de figure sauvegardée -> servira de légende
    const matchFig = ligne.match(/Graphique sauvegard[ée]\s*:\s*(.+\.png)/i);
    if (matchFig) {
      dernierGraphiqueNomme = matchFig[1].trim();
      blocs.push({ type: 'figure_note', texte: dernierGraphiqueNomme });
      i++;
      continue;
    }

    const classee = classifierLigne(ligne);
    if (classee.type !== 'vide') blocs.push(classee);
    i++;
  }

  return blocs;
}

/* ---------------------------------------------------------------------- */
/* Rendu                                                                    */
/* ---------------------------------------------------------------------- */

function TableauGenerique({ entetes, lignes, accent }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--paper)' }}>
            {entetes.map((col, i) => (
              <th key={i} style={{
                textAlign: 'left', borderBottom: '1px solid var(--line)', padding: '9px 12px',
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--slate-soft)',
                whiteSpace: 'nowrap',
              }}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne, i) => (
            <tr key={i}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ transition: 'background 0.1s ease' }}>
              {entetes.map((_, j) => {
                const v = ligne[j] ?? '';
                const estBool = v === 'True' || v === 'False';
                const estSignif = v === 'True' && /signif|p_val/i.test(entetes[j] || '');
                return (
                  <td key={j} style={{
                    padding: '8px 12px', borderBottom: '1px solid var(--line)', color: 'var(--ink)',
                    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                    fontWeight: estBool ? 600 : 400,
                    color: estSignif ? (accent || 'var(--primary-deep)') : 'var(--ink)',
                  }}>{v}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocTitre({ niveau, texte, accent, accentTint }) {
  if (niveau === 1) {
    return (
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 15.5, fontWeight: 700, color: 'var(--ink)',
        paddingBottom: 8, borderBottom: `2px solid ${accentTint}`,
      }}>{texte}</div>
    );
  }
  if (niveau === 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: accent, flexShrink: 0,
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: accent }}>{texte}</span>
      </div>
    );
  }
  return <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--slate)' }}>{texte}</div>;
}

function BlocTexte({ type, texte }) {
  const styles = {
    alerte: { bg: 'var(--error-tint, #fdf1ee)', border: 'rgba(193,80,61,0.28)', color: 'var(--error, #b3462f)', icon: <IconAlert size={14} /> },
    citation: { bg: 'var(--primary-tint)', border: 'transparent', color: 'var(--primary-deep)', icon: null, italic: true },
    ok: { bg: 'transparent', border: 'transparent', color: 'var(--ink)', icon: <IconCheckCircle size={13} /> },
    info: { bg: 'transparent', border: 'transparent', color: 'var(--slate)', icon: null },
    texte: { bg: 'transparent', border: 'transparent', color: 'var(--slate)', icon: null },
  }[type];

  if (type === 'citation') {
    return (
      <div style={{
        background: styles.bg, borderLeft: '3px solid var(--primary)', borderRadius: '0 10px 10px 0',
        padding: '10px 14px', fontSize: 13, lineHeight: 1.6, color: styles.color, fontStyle: 'italic',
      }}>
        « {texte} »
      </div>
    );
  }
  if (type === 'alerte') {
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, background: styles.bg,
        border: `1px solid ${styles.border}`, borderRadius: 10, padding: '9px 12px',
        fontSize: 12.5, lineHeight: 1.55, color: styles.color,
      }}>
        {styles.icon}<span>{texte}</span>
      </div>
    );
  }
  if (type === 'ok') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
        <span style={{ color: 'var(--success, #2f9e63)', marginTop: 1, flexShrink: 0 }}>{styles.icon}</span>
        <span>{texte}</span>
      </div>
    );
  }
  return <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: styles.color }}>{texte}</p>;
}

function ResultatAnalyse({ resultat, accent, accentTint }) {
  const blocs = useMemo(() => parseNotes(resultat.notes), [resultat.notes]);
  const couleurAccent = accent || 'var(--primary-deep)';
  const teinteAccent = accentTint || 'var(--primary-tint)';

  // Regroupe les blocs "linéaires" (titres/texte/tableaux/alertes) en
  // sections délimitées par les titres de niveau 1 ou 2, pour aérer le rendu.
  const sections = useMemo(() => {
    const groupes = [];
    let courant = { titre: null, blocs: [] };
    blocs.forEach((b) => {
      if (b.type === 'titre' && b.niveau <= 2) {
        if (courant.titre || courant.blocs.length) groupes.push(courant);
        courant = { titre: b, blocs: [] };
      } else {
        courant.blocs.push(b);
      }
    });
    if (courant.titre || courant.blocs.length) groupes.push(courant);
    return groupes;
  }, [blocs]);

  const figuresAvecLegende = (resultat.figures || []).map((src, i) => {
    const legende = blocs.filter((b) => b.type === 'figure_note')[i]?.texte;
    return { src, legende };
  });

  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18, animation: 'fadeInResult 0.25s ease' }}>
      <style>{`@keyframes fadeInResult { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      <SectionHeading Icon={IconCheckCircle} title="Résultats" subtitle="Générés à partir des paramètres ci-dessus" />

      {/* Chiffres clés (déjà structurés côté script — test1_sep) */}
      {resultat.resume_stats && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(resultat.resume_stats).map(([cle, val]) => (
            <div key={cle} style={{
              background: 'var(--card)', border: '1px solid var(--line)',
              borderRadius: 12, padding: '10px 16px', minWidth: 112,
              boxShadow: '0 1px 2px rgba(17, 24, 39, 0.03)',
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--slate-soft)' }}>{cle}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: couleurAccent, fontFamily: 'var(--font-display)', marginTop: 2 }}>{String(val)}</div>
            </div>
          ))}
        </div>
      )}

      {resultat.tableau && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--slate-soft)', marginBottom: 8 }}>
            Tableau de résultats
          </div>
          <TableauGenerique
            entetes={Object.keys(resultat.tableau[0] || {})}
            lignes={resultat.tableau.map((l) => Object.values(l))}
            accent={couleurAccent}
          />
        </div>
      )}

      {/* Sortie console (12 scripts non encore refactorés) reconstruite en sections lisibles */}
      {sections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map((sec, si) => (
            <div key={si} style={{
              background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14,
              padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11,
            }}>
              {sec.titre && <BlocTitre {...sec.titre} accent={couleurAccent} accentTint={teinteAccent} />}
              {sec.blocs.map((b, bi) => {
                if (b.type === 'titre') return <BlocTitre key={bi} {...b} accent={couleurAccent} accentTint={teinteAccent} />;
                if (b.type === 'tableau') return <TableauGenerique key={bi} entetes={b.entetes} lignes={b.lignes} accent={couleurAccent} />;
                if (b.type === 'figure_note') return null; // légendes déjà rattachées aux figures
                return <BlocTexte key={bi} type={b.type} texte={b.texte} />;
              })}
            </div>
          ))}
        </div>
      )}

      {figuresAvecLegende.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--slate-soft)', marginBottom: 8 }}>
            Graphiques
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {figuresAvecLegende.map(({ src, legende }, i) => (
              <figure key={i} style={{ margin: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(17, 24, 39, 0.03)' }}>
                <img src={src} alt={legende || `figure-${i}`} style={{ width: '100%', display: 'block' }} />
                <figcaption style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--slate)', borderTop: '1px solid var(--line)' }}>
                  {legende || `Figure ${i + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyseStatistiqueTab() {
  const [analyses, setAnalyses] = useState([]);
  const [registreActif, setRegistreActif] = useState(null); // null = écran de choix SEP/EPR
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

  const compteParRegistre = useMemo(() => ({
    SEP: analyses.filter((a) => a.registre === 'SEP').length,
    EPR: analyses.filter((a) => a.registre === 'EPR').length,
  }), [analyses]);

  const analysesDuRegistre = registreActif ? analyses.filter((a) => a.registre === registreActif) : [];
  const registre = registreActif ? REGISTRES[registreActif] : null;

  const revenirAuChoixRegistre = () => {
    setRegistreActif(null);
    setAnalyseSelectionnee(null);
    setResultat(null);
    setErreur(null);
  };

  const revenirALaListeDesTests = () => {
    setAnalyseSelectionnee(null);
    setResultat(null);
    setErreur(null);
  };

  /* -------------------------------------------------------------- */
  /* Étape 1 — écran de chargement / erreur globale                  */
  /* -------------------------------------------------------------- */
  if (chargement) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {[0, 1].map((i) => (
          <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ height: 130, background: 'var(--paper)' }} />
            <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ height: 16, width: '40%', borderRadius: 6, background: 'var(--paper)' }} />
              <div style={{ height: 12, width: '90%', borderRadius: 6, background: 'var(--paper)' }} />
              <div style={{ height: 12, width: '70%', borderRadius: 6, background: 'var(--paper)' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (erreur && analyses.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        fontSize: 13.5, color: 'var(--error)', padding: 16, borderRadius: 12,
        background: 'var(--error-tint)', border: '1px solid rgba(193,80,61,0.25)',
      }}>
        <IconAlert size={17} />
        <span>{erreur}</span>
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /* Étape 2 — écran de choix du registre (SEP / EPR)                 */
  /* -------------------------------------------------------------- */
  if (!registreActif) {
    return (
      <div>
        <SectionHeading Icon={IconChart} title="Analyse statistique" subtitle="Choisissez d'abord le registre clinique concerné" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {Object.entries(REGISTRES).map(([id, cfg]) => (
            <CarteRegistre
              key={id}
              config={cfg}
              nbTests={compteParRegistre[id] || 0}
              onClick={() => { setRegistreActif(id); setResultat(null); setErreur(null); }}
            />
          ))}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /* Étape 3 — liste des tests du registre choisi                     */
  /* -------------------------------------------------------------- */
  if (!analyseSelectionnee) {
    return (
      <div>
        <BoutonRetour onClick={revenirAuChoixRegistre}>Registres</BoutonRetour>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, background: registre.accentTint, color: registre.accentDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <registre.Icon size={19} />
          </div>
          <div>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
              {registre.label} <span style={{ fontWeight: 400, color: 'var(--slate)' }}>— {registre.nomComplet}</span>
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--slate)', maxWidth: 640, lineHeight: 1.5 }}>{registre.resume}</p>
          </div>
        </div>

        {analysesDuRegistre.length === 0 ? (
          <div style={{ fontSize: 13.5, color: 'var(--slate)', padding: 20, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 12 }}>
            Aucun test {registre.label} disponible pour l'instant.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {analysesDuRegistre.map((a, i) => (
              <button key={a.id} onClick={() => choisirAnalyse(a)} style={{
                textAlign: 'left', margin: 0, padding: '16px 18px', borderRadius: 14,
                border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)',
                cursor: 'pointer', boxShadow: '0 1px 2px rgba(17, 24, 39, 0.03)',
                transition: 'border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
              }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = registre.accent;
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 8px 18px -10px rgba(17, 24, 39, 0.16)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = '0 1px 2px rgba(17, 24, 39, 0.03)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    flexShrink: 0, width: 24, height: 24, borderRadius: 7, background: registre.accentTint,
                    color: registre.accentDeep, fontFamily: 'var(--font-display)', fontSize: 11.5, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', lineHeight: 1.35 }}>{a.titre}</div>
                    <div style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5, color: 'var(--slate)' }}>
                      <span style={{ fontWeight: 600, color: registre.accentDeep }}>But — </span>{a.description}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /* Étape 4 — formulaire de paramètres + résultats                   */
  /* -------------------------------------------------------------- */
  return (
    <div className="card" style={{ padding: 24, maxWidth: 760 }}>
      <BoutonRetour onClick={revenirALaListeDesTests}>Tests {registre.label}</BoutonRetour>

      <SectionHeading
        Icon={registre.Icon}
        title={analyseSelectionnee.titre}
        subtitle={analyseSelectionnee.description}
        accent={registre.accentDeep}
        accentTint={registre.accentTint}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '14px 18px', maxWidth: 640,
      }}>
        {Object.entries(analyseSelectionnee.parametres).map(([nomChamp, schema]) => (
          <label key={nomChamp} style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5, margin: 0 }}>
            {schema.label || nomChamp}
            <ChampFormulaire
              schema={schema}
              valeur={config[nomChamp]}
              onChange={(v) => setConfig((c) => ({ ...c, [nomChamp]: v }))}
            />
          </label>
        ))}
      </div>

      <button onClick={lancer} disabled={enCours} style={{
        marginTop: 20, width: 'auto', padding: '10px 20px', borderRadius: 10, border: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: registre.accent, color: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
      }}>
        {enCours ? (
          <>
            <span style={{
              width: 13, height: 13, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
              display: 'inline-block', animation: 'spin 0.7s linear infinite',
            }} />
            Analyse en cours…
          </>
        ) : (
          <>
            <IconRefresh size={15} />
            Lancer l'analyse
          </>
        )}
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {erreur && (
        <div style={{
          marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 8,
          color: 'var(--error)', background: 'var(--error-tint)', borderRadius: 10,
          padding: '10px 13px', fontSize: 13,
        }}>
          <IconAlert size={15} />
          <span>{erreur}</span>
        </div>
      )}
      {resultat && <ResultatAnalyse resultat={resultat} accent={registre.accentDeep} accentTint={registre.accentTint} />}
    </div>
  );
}
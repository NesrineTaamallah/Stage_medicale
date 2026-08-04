import { useState, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import client from '../api/client';
import {
  IconWave, IconActivity, IconChart, IconAlert, IconCheckCircle,
  IconRefresh, IconArrowRight, IconArrowLeft, IconDownload,
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

/** Un champ "covariables" n'a de sens que si le schéma du test comporte
 * aussi un champ "mode_analyse" ET que ce dernier vaut une variante
 * "multivariée" ("multivariee" côté SEP, "multivariate" côté EPR). Dans
 * tous les autres cas (test sans mode_analyse, ou mode univarié choisi),
 * le champ covariables reste masqué : évite d'afficher un choix de
 * covariables qui ne sera pas pris en compte par le script. */
function covariablesVisibles(nomChamp, parametresSchema, config) {
  if (nomChamp !== 'covariables') return true;
  if (!('mode_analyse' in parametresSchema)) return true;
  return String(config.mode_analyse || '').toLowerCase().includes('multivari');
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
/* Traduction des erreurs techniques en explication clinique lisible       */
/* ---------------------------------------------------------------------- */
/* Le backend renvoie parfois des messages statistiques bruts (matrice      */
/* singulière, séparation parfaite...) : on les reformule ici en une        */
/* phrase compréhensible par un clinicien non-statisticien, affichée        */
/* directement dans la zone Résultats plutôt qu'en petit encart d'erreur.  */

const EXPLICATIONS_ERREUR = [
  {
    motif: /singular matrix/i,
    titre: 'Modèle impossible à ajuster (colinéarité)',
    explication: "Certaines covariables choisies sont trop liées entre elles (ou une catégorie ne varie plus) une fois les patients incomplets exclus. Le modèle ne peut pas isoler l'effet de chaque variable. Essayez de retirer une covariable catégorielle ou d'élargir la fenêtre de tolérance pour garder plus de patients.",
  },
  {
    motif: /perfect ?separation/i,
    titre: 'Séparation parfaite des groupes',
    explication: "Avec ce nombre de covariables et cet effectif, une combinaison de variables prédit parfaitement le pronostic sur ces patients — signe d'un échantillon trop petit pour ce modèle, pas d'un effet réel. Réduisez le nombre de covariables.",
  },
  {
    motif: /effectif insuffisant/i,
    titre: 'Trop peu de patients pour ce modèle',
    explication: "Le nombre de patients disponibles après exclusion des données manquantes est trop faible par rapport au nombre de variables demandées. Réduisez le nombre de covariables ou élargissez la fenêtre de tolérance pour récupérer plus de patients.",
  },
  {
    motif: /patsy|formule/i,
    titre: 'Configuration de modèle invalide',
    explication: "La combinaison de paramètres choisie n'a pas pu être traduite en modèle statistique valide. Essayez une autre combinaison de covariables.",
  },
];

function explicationErreurClinique(message) {
  const trouvee = EXPLICATIONS_ERREUR.find((e) => e.motif.test(message || ''));
  if (trouvee) return trouvee;
  return {
    titre: "L'analyse n'a pas pu aboutir",
    explication: message || "Une erreur inattendue est survenue pendant le calcul statistique.",
  };
}

/** Affiché dans la colonne Résultats à la place de ResultatAnalyse quand
 * l'analyse a échoué : explication en langage clinique, pas de dossier
 * zip puisqu'il n'y a rien à détailler. */
function ResultatErreur({ message, accent }) {
  const { titre, explication } = explicationErreurClinique(message);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionHeading Icon={IconAlert} title="Résultats" subtitle="L'analyse n'a pas pu être calculée" />
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        color: 'var(--error)', background: 'var(--error-tint)', borderRadius: 12,
        padding: '14px 16px', border: '1px solid rgba(193,80,61,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
          <IconAlert size={16} />
          {titre}
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--slate)' }}>{explication}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Popover d'aide : but du test + effet de chaque paramètre                */
/* ---------------------------------------------------------------------- */
/* Le schéma des paramètres vient dynamiquement de l'API (registry.py) et   */
/* varie par test : on donne une explication précise pour les clés          */
/* connues (communes aux tests SEP/EPR de type régression), avec un         */
/* repli générique pour toute clé nouvelle, afin de ne jamais rien casser   */
/* quand un test futur ajoute un paramètre non prévu ici. */

const EXPLICATIONS_PARAMETRES = {
  type_regression: "Modèle statistique utilisé : « linear » prédit une valeur d'EDSS continue ; « logistic » prédit la probabilité de dépasser un seuil de mauvais pronostic.",
  horizon_annees: "Délai après le diagnostic auquel le pronostic est évalué (ex : EDSS à 1 an).",
  tolerance_mois: "Marge acceptée autour de cet horizon pour associer une visite EDSS réelle. Plus large = plus de patients inclus, mais mesure moins précise dans le temps.",
  seuil_logistique: "Score EDSS à partir duquel un patient est considéré en mauvais pronostic (utilisé seulement en régression logistique).",
  mode_analyse: "« Univariée » : effet du délai seul. « Multivariée » : effet du délai ajusté sur d'autres facteurs cliniques (covariables).",
  covariables: "Facteurs cliniques additionnels inclus en mode multivarié. Plus il y en a, plus il faut de patients pour un résultat stable (règle d'environ 5 à 10 patients par variable).",
};

function AideTest({ titre, description, parametresSchema, accent }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOuvert((v) => !v)}
        aria-label="Aide sur ce test"
        title="Aide sur ce test"
        style={{
          width: 22, height: 22, borderRadius: '50%', margin: 0, padding: 0,
          border: `1px solid ${accent || 'var(--primary-deep)'}`, background: 'var(--card)',
          color: accent || 'var(--primary-deep)', fontWeight: 700, fontSize: 12,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
        }}
      >
        ?
      </button>
      {ouvert && (
        <>
          {/* Zone invisible pour fermer le popover au clic extérieur */}
          <div onClick={() => setOuvert(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
          <div style={{
            position: 'absolute', top: 28, left: 0, zIndex: 21, width: 340,
            background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12,
            boxShadow: '0 12px 28px -12px rgba(17, 24, 39, 0.28)', padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{titre}</div>
              {description && <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--slate)' }}>{description}</p>}
            </div>
            {parametresSchema && Object.keys(parametresSchema).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                {Object.entries(parametresSchema).map(([nomChamp, schema]) => (
                  <div key={nomChamp}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--slate-soft)' }}>{schema.label || nomChamp}</div>
                    <p style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--slate)' }}>
                      {EXPLICATIONS_PARAMETRES[nomChamp] || "Paramètre du modèle statistique — ajuste le calcul selon la valeur choisie."}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
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

/** Construit un fichier .txt (chiffres clés + tableau + notes complètes)
 * et un dossier zip contenant ce texte + chaque graphique en .png, pour
 * que le clinicien garde une trace détaillée hors de l'application. */
async function telechargerResultatsZip(resultat, titreAnalyse) {
  const zip = new JSZip();
  const lignes = [];

  lignes.push(`Résultats — ${titreAnalyse || 'Analyse'}`);
  lignes.push(`Généré le ${new Date().toLocaleString('fr-FR')}`);
  lignes.push('');

  if (resultat.resume_stats) {
    lignes.push('=== Chiffres clés ===');
    Object.entries(resultat.resume_stats).forEach(([cle, val]) => lignes.push(`${cle} : ${val}`));
    lignes.push('');
  }

  if (resultat.tableau && resultat.tableau.length) {
    lignes.push('=== Tableau de résultats ===');
    const entetes = Object.keys(resultat.tableau[0]);
    lignes.push(entetes.join('\t'));
    resultat.tableau.forEach((ligne) => lignes.push(entetes.map((e) => ligne[e]).join('\t')));
    lignes.push('');
  }

  if (resultat.notes && resultat.notes.length) {
    lignes.push('=== Détail complet ===');
    lignes.push(...resultat.notes);
  }

  zip.file('resultats.txt', lignes.join('\n'));

  if (resultat.figures && resultat.figures.length) {
    const dossierImages = zip.folder('images');
    resultat.figures.forEach((src, i) => {
      const base64 = String(src).split(',')[1] || '';
      dossierImages.file(`graphique_${String(i + 1).padStart(2, '0')}.png`, base64, { base64: true });
    });
  }

  const contenu = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(contenu);
  const lien = document.createElement('a');
  const nomFichier = (titreAnalyse || 'analyse').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  lien.href = url;
  lien.download = `resultats_${nomFichier || 'analyse'}.zip`;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

function BoutonTelecharger({ resultat, titreAnalyse, accent }) {
  const [enCours, setEnCours] = useState(false);
  const declencher = async () => {
    setEnCours(true);
    try {
      await telechargerResultatsZip(resultat, titreAnalyse);
    } finally {
      setEnCours(false);
    }
  };
  return (
    <button onClick={declencher} disabled={enCours} style={{
      width: 'auto', alignSelf: 'flex-start', padding: '10px 18px', borderRadius: 10,
      border: `1px solid ${accent || 'var(--primary-deep)'}`, background: 'var(--card)',
      color: accent || 'var(--primary-deep)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      <IconDownload size={15} />
      {enCours ? 'Préparation du dossier…' : 'Télécharger les résultats (.zip)'}
    </button>
  );
}

/** Détermine un badge de signification statistique à partir du premier
 * champ "p_value" (ou équivalent) trouvé dans resume_stats, pour donner
 * une lecture immédiate en un coup d'œil (vrai réflexe dashboard clinique). */
function badgeSignification(resumeStats) {
  if (!resumeStats) return null;
  const cleP = Object.keys(resumeStats).find((k) => /^p[_-]?value$|^p$/i.test(k));
  if (!cleP) return null;
  const p = Number(resumeStats[cleP]);
  if (Number.isNaN(p)) return null;
  const significatif = p < 0.05;
  return {
    texte: significatif ? `Significatif (p=${p})` : `Non significatif (p=${p})`,
    couleur: significatif ? 'var(--success, #1a7a4c)' : 'var(--slate)',
    fond: significatif ? 'var(--success-tint, #e6f4ec)' : 'var(--paper)',
  };
}

function ResultatAnalyse({ resultat, accent, accentTint, titreAnalyse }) {
  const blocs = useMemo(() => parseNotes(resultat.notes), [resultat.notes]);
  const couleurAccent = accent || 'var(--primary-deep)';
  const teinteAccent = accentTint || 'var(--primary-tint)';

  // Vue "dashboard" : on ne montre que l'essentiel — chiffres clés, UN
  // graphique principal (le premier renvoyé par le script, considéré comme
  // la figure de synthèse), et le tableau de résultats. Tout le reste
  // (notes détaillées, graphiques secondaires, log complet) part dans le
  // zip téléchargeable pour ne pas noyer le clinicien sous le détail.
  const figureLegendes = blocs.filter((b) => b.type === 'figure_note');
  const figurePrincipale = (resultat.figures || [])[0];
  const legendePrincipale = figureLegendes[0]?.texte;
  const nbFiguresSecondaires = Math.max((resultat.figures || []).length - 1, 0);
  const nbNotesDetail = (resultat.notes || []).length;

  const badge = badgeSignification(resultat.resume_stats);

  return (
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18, animation: 'fadeInResult 0.25s ease' }}>
      <style>{`@keyframes fadeInResult { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <SectionHeading Icon={IconCheckCircle} title="Points clés" subtitle="Résultats essentiels de l'analyse" />
        {badge && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
            color: badge.couleur, background: badge.fond, border: `1px solid ${badge.couleur}`,
            whiteSpace: 'nowrap',
          }}>
            {badge.texte}
          </span>
        )}
      </div>

      {/* Chiffres clés — cartes compactes, lecture immédiate */}
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

      {/* Graphique principal — un seul, mis en avant */}
      {figurePrincipale && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--slate-soft)', marginBottom: 8 }}>
            Graphique clé
          </div>
          <figure style={{ margin: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 2px rgba(17, 24, 39, 0.03)', maxWidth: 560 }}>
            <img src={figurePrincipale} alt={legendePrincipale || 'graphique principal'} style={{ width: '100%', display: 'block' }} />
            {legendePrincipale && (
              <figcaption style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--slate)', borderTop: '1px solid var(--line)' }}>
                {legendePrincipale}
              </figcaption>
            )}
          </figure>
        </div>
      )}

      {/* Tableau de résultats clé */}
      {resultat.tableau && resultat.tableau.length > 0 && (
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

      {/* Renvoi explicite vers le détail complet, plutôt que de l'afficher ici */}
      <div style={{
        marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 12.5, color: 'var(--slate)', background: teinteAccent, borderRadius: 10, padding: '10px 14px' }}>
          {nbNotesDetail > 0 && `${nbNotesDetail} ligne(s) de détail`}
          {nbFiguresSecondaires > 0 && ` · ${nbFiguresSecondaires} graphique(s) supplémentaire(s)`}
          {' '}disponibles dans le dossier téléchargeable ci-dessous (log complet, VIF, résidus, matrice de confusion...).
        </div>
        <BoutonTelecharger resultat={resultat} titreAnalyse={titreAnalyse} accent={couleurAccent} />
        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--slate-soft)' }}>
          Le dossier .zip contient resultats.txt (chiffres clés, tableau et détail complet)
          et un dossier images/ avec l'ensemble des graphiques en .png.
        </p>
      </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Retour + titre du test, au-dessus du cadre blanc */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ margin: 0 }}>
          <BoutonRetour onClick={revenirALaListeDesTests}>Tests {registre.label}</BoutonRetour>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SectionHeading
            Icon={registre.Icon}
            title={analyseSelectionnee.titre}
            subtitle={analyseSelectionnee.description}
            accent={registre.accentDeep}
            accentTint={registre.accentTint}
          />
          <AideTest
            titre={analyseSelectionnee.titre}
            description={analyseSelectionnee.description}
            parametresSchema={analyseSelectionnee.parametres}
            accent={registre.accentDeep}
          />
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
        gap: 20, alignItems: 'flex-start',
      }}>
        {/* Colonne gauche : formulaire — scroll indépendant, reste visible pendant qu'on parcourt les résultats */}
        <div className="card" style={{
          padding: 22, flex: '1 1 380px', maxWidth: 480,
          display: 'flex', flexDirection: 'column', gap: 16,
          maxHeight: 'calc(100vh - 150px)', overflowY: 'auto',
          position: 'sticky', top: 16,
        }}>
          <button onClick={lancer} disabled={enCours} style={{
            margin: 0, width: '100%', padding: '11px 18px', borderRadius: 10, border: 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
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

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 14,
            paddingTop: 4, borderTop: '1px solid var(--line)',
          }}>
            {Object.entries(analyseSelectionnee.parametres)
              .filter(([nomChamp]) => covariablesVisibles(nomChamp, analyseSelectionnee.parametres, config))
              .map(([nomChamp, schema]) => (
                <label key={nomChamp} style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 5, margin: 0 }}>
                  {schema.label || nomChamp}
                  <ChampFormulaire
                    schema={schema}
                    valeur={config[nomChamp]}
                    onChange={(v) => setConfig((c) => {
                      // Repasser en univarié vide la sélection de covariables,
                      // pour ne pas envoyer au backend un choix devenu invisible.
                      if (nomChamp === 'mode_analyse' && !String(v).toLowerCase().includes('multivari')) {
                        return { ...c, [nomChamp]: v, covariables: [] };
                      }
                      return { ...c, [nomChamp]: v };
                    })}
                  />
                </label>
              ))}
          </div>
        </div>

        {/* Colonne droite : résultats — scroll indépendant, ne bouge pas quand on scrolle le formulaire */}
        {resultat && (
          <div className="card" style={{
            padding: 22, flex: '2 1 480px', maxWidth: 760,
            maxHeight: 'calc(100vh - 150px)', overflowY: 'auto',
          }}>
            <ResultatAnalyse
              resultat={resultat}
              accent={registre.accentDeep}
              accentTint={registre.accentTint}
              titreAnalyse={analyseSelectionnee.titre}
            />
          </div>
        )}
      </div>
    </div>
  );
}
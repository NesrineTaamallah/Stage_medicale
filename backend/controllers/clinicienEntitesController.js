const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');

/**
 * GET /api/clinicien/entites/alerte/:type
 * Alimente la fenêtre "Entités Médicales" quand elle est ouverte depuis une
 * carte d'alerte de la Vue d'Ensemble. Reprend EXACTEMENT la même condition
 * SQL que la carte de comptage correspondante dans clinicienOverviewController.js
 * (même WHERE / HAVING), mais renvoie la liste des pseudonymes concernés au
 * lieu d'un simple COUNT(*).
 *
 * :type ∈ {
 *   suiviEnRetard, irmAncienne, traitementsEcheance,
 *   eegAncien, bilanMultidisciplinaireAbsent, transitionAdulte,
 *   identiteManquante
 * }
 */

const REQUETES = {
  // --- Suivi actif mais point de suivi > 6 mois (SEP + EPR) ---
  suiviEnRetard: async () => {
    const sql = `
      SELECT pseudonyme, 'SEP' AS registre, date_dernier_suivi AS derniere_info,
             statut_dernier_suivi AS statut
      FROM sep_suivi s
      WHERE ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
        AND s.date_dernier_suivi IS NOT NULL
        AND s.date_dernier_suivi < now() - interval '6 months'

      UNION ALL

      SELECT s.pseudonyme, 'EPR' AS registre, act.derniere_activite AS derniere_info,
             s.statut_dernier_suivi AS statut
      FROM epr_suivi s
      LEFT JOIN (
        SELECT p.pseudonyme,
               GREATEST(
                 MAX(fc.date_rapport), MAX(tc.date_observation), MAX(eeg.date_eeg),
                 MAX(im.date_examen), MAX(bp.date_bilan), MAX(bn.date_bilan),
                 MAX(bo.date_bilan), MAX(be.date_bilan), MAX(ch.date_chirurgie),
                 MAX(alt.date_debut)
               ) AS derniere_activite
        FROM patients p
        LEFT JOIN epr_frequence_crises fc ON fc.pseudonyme = p.pseudonyme
        LEFT JOIN epr_type_crise tc ON tc.pseudonyme = p.pseudonyme
        LEFT JOIN epr_eeg eeg ON eeg.pseudonyme = p.pseudonyme
        LEFT JOIN epr_imagerie im ON im.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_prechirurgical bp ON bp.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_neuropsy bn ON bn.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_orthophonique bo ON bo.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_ergotherapique be ON be.pseudonyme = p.pseudonyme
        LEFT JOIN epr_chirurgie ch ON ch.pseudonyme = p.pseudonyme
        LEFT JOIN epr_alternatives_therapeutiques alt ON alt.pseudonyme = p.pseudonyme
        WHERE p.registre = 'EPR'
        GROUP BY p.pseudonyme
      ) act ON act.pseudonyme = s.pseudonyme
      WHERE ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
        AND act.derniere_activite IS NOT NULL
        AND act.derniere_activite < now() - interval '6 months'
      ORDER BY derniere_info ASC NULLS FIRST
    `;
    return pool.query(sql);
  },

  // --- SEP sans IRM depuis > 12 mois (y compris jamais explorés) ---
  irmAncienne: async () => pool.query(`
    SELECT p.pseudonyme, 'SEP' AS registre, MAX(i.date_examen) AS derniere_info,
           NULL::text AS statut
    FROM patients p
    LEFT JOIN sep_irm i ON i.pseudonyme = p.pseudonyme
    WHERE p.registre = 'SEP'
    GROUP BY p.pseudonyme
    HAVING MAX(i.date_examen) IS NULL
        OR MAX(i.date_examen) < now() - interval '12 months'
    ORDER BY derniere_info ASC NULLS FIRST
  `),

  // --- SEP : traitement de fond arrivant à échéance sous 30 jours ---
  traitementsEcheance: async () => pool.query(`
    SELECT pseudonyme, 'SEP' AS registre, date_fin AS derniere_info,
           molecule AS statut
    FROM sep_traitement_fond
    WHERE date_fin IS NOT NULL
      AND date_fin BETWEEN now() AND now() + interval '30 days'
    ORDER BY date_fin ASC
  `),

  // --- EPR sans EEG depuis > 12 mois (y compris jamais explorés) ---
  eegAncien: async () => pool.query(`
    SELECT p.pseudonyme, 'EPR' AS registre, MAX(e.date_eeg) AS derniere_info,
           NULL::text AS statut
    FROM patients p
    LEFT JOIN epr_eeg e ON e.pseudonyme = p.pseudonyme
    WHERE p.registre = 'EPR'
    GROUP BY p.pseudonyme
    HAVING MAX(e.date_eeg) IS NULL
        OR MAX(e.date_eeg) < now() - interval '12 months'
    ORDER BY derniere_info ASC NULLS FIRST
  `),

  // --- EPR sans aucun bilan multidisciplinaire (neuropsy / orthophonie / ergo) ---
  bilanMultidisciplinaireAbsent: async () => pool.query(`
    SELECT p.pseudonyme, 'EPR' AS registre, NULL::date AS derniere_info,
           NULL::text AS statut
    FROM patients p
    LEFT JOIN epr_bilan_neuropsy bn ON bn.pseudonyme = p.pseudonyme
    LEFT JOIN epr_bilan_orthophonique bo ON bo.pseudonyme = p.pseudonyme
    LEFT JOIN epr_bilan_ergotherapique be ON be.pseudonyme = p.pseudonyme
    WHERE p.registre = 'EPR'
      AND bn.pseudonyme IS NULL AND bo.pseudonyme IS NULL AND be.pseudonyme IS NULL
  `),

  // --- Transition ado → adulte (16-18 ans), en suivi actif ---
  // Reprend EXACTEMENT la même condition que la carte de comptage
  // correspondante dans clinicienOverviewController.js.
  transitionAdulte: async () => pool.query(`
    SELECT e.pseudonyme, e.registre, NULL::date AS derniere_info,
           e.statut
    FROM (
      SELECT
        p.pseudonyme,
        p.registre,
        p.age + EXTRACT(YEAR FROM age(now(), COALESCE(p.date_inclusion, now()))) AS age_estime,
        COALESCE(ss.statut_dernier_suivi, es.statut_dernier_suivi) AS statut
      FROM patients p
      LEFT JOIN sep_suivi ss ON ss.pseudonyme = p.pseudonyme
      LEFT JOIN epr_suivi es ON es.pseudonyme = p.pseudonyme
      WHERE p.age IS NOT NULL
    ) e
    WHERE e.age_estime BETWEEN 16 AND 18
      AND ${normalizedSql('e.statut')} NOT IN ('perdu de vue', 'decede')
    ORDER BY e.pseudonyme
  `),

  // --- Fiches sans extraction des données patient ---
  // Reprend EXACTEMENT la même condition que la carte de comptage
  // correspondante dans clinicienOverviewController.js : un patient est
  // listé s'il a au moins un document dont le texte est validé
  // (texte_transcrit renseigné) mais pas encore extrait
  // (coordonnees_extraites = false). Dès que l'extraction est faite et
  // enregistrée, ce document ne compte plus et le patient sort de la liste
  // s'il n'a plus aucun autre document en attente.
  identiteManquante: async () => pool.query(`
    SELECT DISTINCT p.pseudonyme, p.registre, NULL::date AS derniere_info,
           NULL::text AS statut
    FROM patients p
    JOIN documents_bruts d
      ON d.pseudonyme = p.pseudonyme
     AND d.texte_transcrit IS NOT NULL
     AND TRIM(d.texte_transcrit) <> ''
     AND d.coordonnees_extraites = false
    ORDER BY p.pseudonyme
  `),
};

const LABELS = {
  suiviEnRetard: 'Suivi actif mais point de suivi > 6 mois',
  irmAncienne: 'SEP sans IRM depuis > 12 mois',
  traitementsEcheance: 'Traitements SEP à échéance (30 j)',
  eegAncien: 'EPR sans EEG depuis > 12 mois',
  bilanMultidisciplinaireAbsent: 'EPR sans aucun bilan multidisciplinaire',
  transitionAdulte: 'Transition ado → adulte (16-18 ans)',
  identiteManquante: 'Fiches sans extraction des données',
};

async function getListePatientsAlerte(req, res) {
  const { type } = req.params;
  const runner = REQUETES[type];
  if (!runner) {
    return res.status(400).json({ error: "Type d'alerte inconnu." });
  }
  try {
    const result = await runner();
    res.json({
      type,
      label: LABELS[type],
      total: result.rowCount,
      patients: result.rows.map((r) => ({
        pseudonyme: r.pseudonyme,
        registre: r.registre,
        derniereInfo: r.derniere_info instanceof Date ? r.derniere_info.toISOString().slice(0, 10) : r.derniere_info,
        statut: r.statut,
      })),
    });
  } catch (err) {
    console.error('Erreur getListePatientsAlerte :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getListePatientsAlerte };
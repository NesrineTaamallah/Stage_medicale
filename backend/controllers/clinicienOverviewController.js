const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');

/**
 * GET /api/clinicien/overview
 * Alimente désormais UNIQUEMENT la fenêtre "Vue d'Ensemble" (recentrée) :
 * KPI globaux, comparatif SEP/EPR, alertes de suivi transversales, et flux
 * d'activité du clinicien connecté. Le détail clinique propre à chaque
 * registre a été déplacé vers /api/clinicien/registre-sep et
 * /api/clinicien/registre-epr (cf. clinicienSepController.js /
 * clinicienEprController.js) pour donner à chaque pathologie sa propre
 * fenêtre au lieu d'un unique onglet fourre-tout.
 */
async function getClinicienOverview(req, res) {
  try {
    const [
      totals,
      sexeRepartition,
      ageRepartition,
      fichesIdentite,
      inclusionsByMonth,
      statutSuiviSep,
      statutSuiviEpr,
      alertesSuiviEnRetard,
      alertesIrmAncienne,
      alertesTraitementsEcheance,
      alertesEegAncien,
      alertesBilanMultidisciplinaireAbsent,
      alertesTransitionAdulte,
      recentActivity,
    ] = await Promise.all([
      // --- KPI globaux ---
      pool.query(`
        SELECT
          COUNT(*)::int AS total_patients,
          COUNT(*) FILTER (WHERE registre = 'SEP')::int AS total_sep,
          COUNT(*) FILTER (WHERE registre = 'EPR')::int AS total_epr,
          COUNT(*) FILTER (WHERE date_inclusion >= date_trunc('month', now()))::int AS inclusions_ce_mois
        FROM patients
      `),

      // --- Répartition par sexe ---
      // CORRECTION : schema_registre.sql ne documente 'sexe' que côté SEP
      // (sep_identification_clinique) ; epr_identification_clinique n'a pas
      // cette colonne. L'ancienne requête noyait donc TOUS les patients EPR
      // dans "Non renseigné", ce qui rendait le donut trompeur (on ne peut
      // pas distinguer "EPR sans donnée sexe dans le schéma actuel" de "SEP
      // avec sexe non saisi"). Sans modifier le schéma, on sépare les deux
      // cas pour rester honnête vis-à-vis du clinicien.
      pool.query(`
        SELECT
          CASE
            WHEN p.registre = 'EPR' THEN 'Non applicable (EPR — champ absent du registre)'
            ELSE COALESCE(NULLIF(TRIM(ic.sexe), ''), 'Non renseigné')
          END AS sexe,
          COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN sep_identification_clinique ic ON ic.pseudonyme = p.pseudonyme
        GROUP BY 1
      `),

      // --- Répartition par tranche d'âge ---
      // CORRECTION : 'age' est saisi une seule fois à l'inclusion et ne bouge
      // plus jamais (bug identifié : un enfant inclus à 5 ans reste affiché
      // en "2-6 ans" toute sa vie dans le registre). Le schéma ne contient
      // pas de date de naissance, donc on approxime l'âge actuel en ajoutant
      // le temps écoulé depuis l'inclusion — approximation raisonnable et
      // strictement meilleure que l'âge figé, sans toucher au schéma.
      pool.query(`
        SELECT
          CASE
            WHEN age IS NULL THEN 'Non renseigné'
            WHEN age_estime < 2 THEN '0-2 ans'
            WHEN age_estime < 6 THEN '2-6 ans'
            WHEN age_estime < 12 THEN '6-12 ans'
            WHEN age_estime < 18 THEN '12-18 ans'
            ELSE '18 ans et +'
          END AS tranche,
          COUNT(*)::int AS count
        FROM (
          SELECT
            age,
            age + EXTRACT(YEAR FROM age(now(), COALESCE(date_inclusion, now()))) AS age_estime
          FROM patients
        ) e
        GROUP BY tranche
      `),

      // --- Fiches identité (coordonnee_patient) manquantes ---
      pool.query(`
        SELECT
          COUNT(p.pseudonyme)::int AS total_patients,
          COUNT(cp.pseudonyme)::int AS fiches_renseignees,
          (COUNT(p.pseudonyme) - COUNT(cp.pseudonyme))::int AS fiches_manquantes
        FROM patients p
        LEFT JOIN coordonnee_patient cp ON cp.pseudonyme = p.pseudonyme
      `),

      // --- Courbe des inclusions par mois (12 derniers mois, SEP vs EPR) ---
      pool.query(`
        SELECT
          to_char(m, 'YYYY-MM') AS month,
          COALESCE(COUNT(p.pseudonyme) FILTER (WHERE p.registre = 'SEP'), 0)::int AS sep,
          COALESCE(COUNT(p.pseudonyme) FILTER (WHERE p.registre = 'EPR'), 0)::int AS epr
        FROM generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          interval '1 month'
        ) m
        LEFT JOIN patients p
          ON date_trunc('month', p.date_inclusion) = m
        GROUP BY m
        ORDER BY m
      `),

      // --- Statut de suivi SEP ---
      pool.query(`
        SELECT COALESCE(statut_dernier_suivi, 'Non renseigné') AS statut, COUNT(*)::int AS count
        FROM sep_suivi
        GROUP BY statut_dernier_suivi
      `),

      // --- Statut de suivi EPR ---
      pool.query(`
        SELECT COALESCE(statut_dernier_suivi, 'Non renseigné') AS statut, COUNT(*)::int AS count
        FROM epr_suivi
        GROUP BY statut_dernier_suivi
      `),

      // --- Alerte : suivi toujours en cours mais dernier point de suivi ancien (> 6 mois) ---
      pool.query(`
        SELECT COUNT(*)::int AS count FROM (
          SELECT s.pseudonyme
          FROM sep_suivi s
          WHERE ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
            AND s.date_dernier_suivi IS NOT NULL
            AND s.date_dernier_suivi < now() - interval '6 months'

          UNION ALL

          SELECT s.pseudonyme
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
        ) alertes
      `),

      // --- Alerte SEP : pas d'IRM depuis plus de 12 mois, y compris les patients
      //     n'ayant JAMAIS eu d'IRM ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN sep_irm i ON i.pseudonyme = p.pseudonyme
        WHERE p.registre = 'SEP'
        GROUP BY p.pseudonyme
        HAVING MAX(i.date_examen) IS NULL
            OR MAX(i.date_examen) < now() - interval '12 months'
      `).then((r) => ({ rows: [{ count: r.rowCount }] })),

      // --- Alerte SEP : traitement de fond arrivant à échéance sous 30 jours ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM sep_traitement_fond
        WHERE date_fin IS NOT NULL
          AND date_fin BETWEEN now() AND now() + interval '30 days'
      `),

      // --- Alerte EPR : pas d'EEG depuis plus de 12 mois, y compris les
      //     patients n'ayant JAMAIS eu d'EEG ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN epr_eeg e ON e.pseudonyme = p.pseudonyme
        WHERE p.registre = 'EPR'
        GROUP BY p.pseudonyme
        HAVING MAX(e.date_eeg) IS NULL
            OR MAX(e.date_eeg) < now() - interval '12 months'
      `).then((r) => ({ rows: [{ count: r.rowCount }] })),

      // --- Alerte EPR : aucun bilan multidisciplinaire (neuropsy, orthophonie,
      //     ergothérapie) jamais réalisé ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN epr_bilan_neuropsy bn ON bn.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_orthophonique bo ON bo.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_ergotherapique be ON be.pseudonyme = p.pseudonyme
        WHERE p.registre = 'EPR'
          AND bn.pseudonyme IS NULL AND bo.pseudonyme IS NULL AND be.pseudonyme IS NULL
      `),

      // --- Alerte transversale : transition ado → adulte ---
      // Enjeu majeur en pédiatrie, absent de l'ancienne vue d'ensemble.
      // Âge actuel approximé (age à l'inclusion + temps écoulé, cf. supra),
      // patients encore en suivi actif (ni perdu de vue, ni décédé/résolu).
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT
            p.pseudonyme,
            p.age + EXTRACT(YEAR FROM age(now(), COALESCE(p.date_inclusion, now()))) AS age_estime,
            COALESCE(ss.statut_dernier_suivi, es.statut_dernier_suivi) AS statut
          FROM patients p
          LEFT JOIN sep_suivi ss ON ss.pseudonyme = p.pseudonyme
          LEFT JOIN epr_suivi es ON es.pseudonyme = p.pseudonyme
          WHERE p.age IS NOT NULL
        ) e
        WHERE e.age_estime BETWEEN 16 AND 18
          AND ${normalizedSql('e.statut')} NOT IN ('perdu de vue', 'decede')
      `),

      // --- Activité récente du clinicien connecté, agrégée par jour ---
      pool.query(
        `SELECT
           d::date AS day,
           COUNT(*) FILTER (WHERE al.action LIKE 'coordonnee_patient_reveal%')::int AS fiches_consultees,
           COUNT(*) FILTER (WHERE al.action LIKE 'analyse_statistique%')::int AS analyses_lancees
         FROM generate_series(
           (now() - interval '6 days')::date,
           now()::date,
           interval '1 day'
         ) d
         LEFT JOIN access_logs al
           ON al.created_at::date = d
           AND al.user_id = $1
           AND (al.action LIKE 'coordonnee_patient_reveal%' OR al.action LIKE 'analyse_statistique%')
         GROUP BY d
         ORDER BY d`,
        [req.user.sub]
      ),
    ]);

    res.json({
      totals: totals.rows[0],
      sexeRepartition: sexeRepartition.rows,
      ageRepartition: ageRepartition.rows,
      ageEstimeApproximatif: true, // schéma sans date de naissance : âge dérivé de l'âge à l'inclusion + temps écoulé
      fichesIdentite: fichesIdentite.rows[0],
      inclusionsByMonth: inclusionsByMonth.rows,
      comparatifSuivi: {
        sep: statutSuiviSep.rows,
        epr: statutSuiviEpr.rows,
      },
      alertes: {
        suiviEnRetard: alertesSuiviEnRetard.rows[0]?.count ?? 0,
        irmAncienne: alertesIrmAncienne.rows[0]?.count ?? 0,
        traitementsEcheance: alertesTraitementsEcheance.rows[0]?.count ?? 0,
        eegAncien: alertesEegAncien.rows[0]?.count ?? 0,
        bilanMultidisciplinaireAbsent: alertesBilanMultidisciplinaireAbsent.rows[0]?.count ?? 0,
        transitionAdulte: alertesTransitionAdulte.rows[0]?.count ?? 0,
      },
      recentActivity: recentActivity.rows.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
        fiches_consultees: r.fiches_consultees,
        analyses_lancees: r.analyses_lancees,
      })),
    });
  } catch (err) {
    console.error('Erreur getClinicienOverview :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienOverview };
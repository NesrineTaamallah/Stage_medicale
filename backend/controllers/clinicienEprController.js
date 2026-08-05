const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');

/**
 * GET /api/clinicien/registre-epr
 * Alimente la fenêtre "Registre EPR" (Épilepsie pharmacorésistante
 * pédiatrique), détachée de la Vue d'Ensemble. Toutes les requêtes sont
 * reprises à l'identique de l'ancien clinicienOverviewController.js — seule
 * leur répartition entre fenêtres a changé.
 */
async function getClinicienRegistreEpr(req, res) {
  try {
    const [
      eprPharmacoresistance,
      eprEtiologies,
      eprFrequenceCrises,
      eprTypesCrise,
      eprAgeDebutCrises,
      eprAgeDiagnosticPharmacoresistance,
      eprDureeSuivi,
      eprRegressionDeveloppementale,
      eprEligibiliteChirurgicale,
      eprEvolutionPostChirurgie,
      eprComorbiditesNeuropsy,
    ] = await Promise.all([
      // --- EPR : % de pharmacorésistance confirmée ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(TRIM(statut_pharmacoresistance_confirme::text)) IN ('oui', 'true', 't', '1'))::int AS confirmes,
          COUNT(*)::int AS total
        FROM epr_pharmacoresistance
      `),

      // --- EPR : répartition des étiologies ---
      pool.query(`
        SELECT COALESCE(categorie_etiologique, 'Non renseigné') AS categorie, COUNT(*)::int AS count
        FROM epr_etiologie
        WHERE etiologie_principale = TRUE
        GROUP BY categorie_etiologique
      `),

      // --- EPR : fréquence de crises moyenne (dernier rapport par patient) ---
      pool.query(`
        SELECT ROUND(AVG(frequence_normalisee_mois)::numeric, 1) AS moyenne
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, frequence_normalisee_mois
          FROM epr_frequence_crises
          WHERE frequence_normalisee_mois IS NOT NULL
          ORDER BY pseudonyme, date_rapport DESC
        ) dernier
      `),

      // --- EPR : répartition des types de crise ILAE 2017 ---
      pool.query(`
        SELECT COALESCE(type_crise_ilae2017, 'Non renseigné') AS type, COUNT(*)::int AS count
        FROM epr_type_crise
        GROUP BY type_crise_ilae2017
        ORDER BY count DESC
        LIMIT 8
      `),

      // --- EPR : âge moyen au début des crises (mois) ---
      pool.query(`SELECT ROUND(AVG(age_debut_crises_mois)::numeric, 1) AS moyenne FROM epr_identification_clinique WHERE age_debut_crises_mois IS NOT NULL`),

      // --- EPR : âge moyen au diagnostic de pharmacorésistance (mois) ---
      pool.query(`SELECT ROUND(AVG(age_diagnostic_pharmacoresistance_mois)::numeric, 1) AS moyenne FROM epr_identification_clinique WHERE age_diagnostic_pharmacoresistance_mois IS NOT NULL`),

      // --- EPR : durée de suivi moyenne (mois) ---
      pool.query(`SELECT ROUND(AVG(duree_suivi_mois)::numeric, 1) AS moyenne FROM epr_suivi WHERE duree_suivi_mois IS NOT NULL`),

      // --- EPR : prévalence de la régression développementale ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE presence_regression = TRUE)::int AS positifs,
          COUNT(*) FILTER (WHERE presence_regression IS NOT NULL)::int AS total
        FROM epr_regression_developpementale
      `),

      // --- EPR : éligibilité chirurgicale parmi les patients ayant eu un bilan
      //     pré-chirurgical (un patient peut avoir plusieurs bilans -> on ne
      //     retient que le plus récent) ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE eligibilite_chirurgie = TRUE)::int AS eligibles,
          COUNT(*)::int AS total_evalues
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, eligibilite_chirurgie
          FROM epr_bilan_prechirurgical
          WHERE eligibilite_chirurgie IS NOT NULL
          ORDER BY pseudonyme, date_bilan DESC
        ) dernier
      `),

      // --- EPR : devenir post-chirurgical (répartition) ---
      pool.query(`
        SELECT COALESCE(evolution_post_chirurgie, 'Non renseigné') AS evolution, COUNT(*)::int AS count
        FROM epr_chirurgie
        WHERE chirurgie_realisee = TRUE
        GROUP BY evolution_post_chirurgie
        ORDER BY count DESC
      `),

      // --- EPR : comorbidités neuropsychologiques (dernier bilan neuropsy par
      //     patient) — TSA/TDAH, troubles du comportement, troubles du sommeil. ---
      pool.query(`
        SELECT
          COUNT(*)::int AS total_evalues,
          COUNT(*) FILTER (WHERE troubles_comportement = TRUE)::int AS troubles_comportement,
          COUNT(*) FILTER (WHERE ${normalizedSql('troubles_psy_associes')} = 'oui')::int AS troubles_psy_associes,
          COUNT(*) FILTER (WHERE troubles_sommeil = TRUE)::int AS troubles_sommeil
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, troubles_comportement, troubles_psy_associes, troubles_sommeil
          FROM epr_bilan_neuropsy
          ORDER BY pseudonyme, date_bilan DESC
        ) dernier
      `),
    ]);

    res.json({
      pharmacoresistance: eprPharmacoresistance.rows[0],
      etiologies: eprEtiologies.rows,
      frequenceCrisesMoyenne: eprFrequenceCrises.rows[0]?.moyenne,
      typesCrise: eprTypesCrise.rows,
      ageDebutCrisesMoyenMois: eprAgeDebutCrises.rows[0]?.moyenne,
      ageDiagnosticPharmacoresistanceMoyenMois: eprAgeDiagnosticPharmacoresistance.rows[0]?.moyenne,
      dureeSuiviMoyenneMois: eprDureeSuivi.rows[0]?.moyenne,
      regressionDeveloppementale: eprRegressionDeveloppementale.rows[0],
      eligibiliteChirurgicale: eprEligibiliteChirurgicale.rows[0],
      evolutionPostChirurgie: eprEvolutionPostChirurgie.rows,
      comorbiditesNeuropsy: eprComorbiditesNeuropsy.rows[0],
    });
  } catch (err) {
    console.error('Erreur getClinicienRegistreEpr :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienRegistreEpr };

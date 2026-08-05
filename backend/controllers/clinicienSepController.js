const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');

/**
 * GET /api/clinicien/registre-sep
 * Alimente la fenêtre "Registre SEP" (Sclérose En Plaques pédiatrique),
 * détachée de la Vue d'Ensemble. Toutes les requêtes sont reprises à
 * l'identique de l'ancien clinicienOverviewController.js — seule leur
 * répartition entre fenêtres a changé.
 */
async function getClinicienRegistreSep(req, res) {
  try {
    const [
      gouvernoratRepartition,
      sepDelaiDiagnostic,
      sepFormesEvolutives,
      sepEdssRecent,
      sepPousseesRecentes,
      sepTraitementsActifs,
      sepActiviteIrm,
      sepBandesOligoclonales,
      sepPresentationInitiale,
      sepLignesTherapeutiques,
      sepMotifsSwitch,
      sepConsanguinite,
      sepDelaiConversionSp,
    ] = await Promise.all([
      // --- Répartition par gouvernorat (registre SEP uniquement — seul registre
      //     qui capture ce champ actuellement) ---
      pool.query(`
        SELECT COALESCE(gouvernorat_code, 'Non renseigné') AS gouvernorat, COUNT(*)::int AS count
        FROM sep_identification_clinique
        GROUP BY gouvernorat_code
        ORDER BY count DESC
      `),

      // --- SEP : délai diagnostic moyen (mois) ---
      pool.query(`SELECT ROUND(AVG(delai_diagnostic_mois)::numeric, 1) AS moyenne FROM sep_identification_clinique WHERE delai_diagnostic_mois IS NOT NULL`),

      // --- SEP : répartition des formes évolutives ---
      pool.query(`
        SELECT COALESCE(forme_evolutive, 'Non renseigné') AS forme, COUNT(*)::int AS count
        FROM sep_evolution
        GROUP BY forme_evolutive
      `),

      // --- SEP : dernier score EDSS moyen (une visite la plus récente par patient) ---
      pool.query(`
        SELECT ROUND(AVG(score_edss)::numeric, 1) AS moyenne, COUNT(*)::int AS nb_patients
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, score_edss
          FROM sep_edss_visites
          WHERE score_edss IS NOT NULL
          ORDER BY pseudonyme, date_visite DESC
        ) dernier
      `),

      // --- SEP : poussées des 90 derniers jours ---
      pool.query(`SELECT COUNT(*)::int AS count FROM sep_poussees WHERE date_poussee >= now() - interval '90 days'`),

      // --- SEP : patients sous traitement de fond actif (pas de date de fin) ---
      pool.query(`
        SELECT COUNT(DISTINCT pseudonyme)::int AS count
        FROM sep_traitement_fond
        WHERE date_fin IS NULL
      `),

      // --- SEP : % de dernières IRM montrant de nouvelles lésions ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(TRIM(nouvelles_lesions_vs_irm_anterieure::text)) IN ('oui', 'true', 't', '1'))::int AS avec_nouvelles_lesions,
          COUNT(*)::int AS total
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, nouvelles_lesions_vs_irm_anterieure
          FROM sep_irm
          ORDER BY pseudonyme, date_examen DESC
        ) derniere
      `),

      // --- SEP : % de bandes oligoclonales positives (dernier prélèvement LCR) ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE ${normalizedSql('bandes_oligoclonales')}
                  IN ('positif', 'positive', 'oui', 'true', 't', '1')
          )::int AS positifs,
          COUNT(*)::int AS total
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, bandes_oligoclonales
          FROM sep_biologie_lcr
          WHERE bandes_oligoclonales IS NOT NULL
            AND TRIM(bandes_oligoclonales) <> ''
          ORDER BY pseudonyme, date_prelevement DESC
        ) dernier
      `),

      // --- SEP : présentation initiale (type de 1er événement + récupération complète) ---
      pool.query(`
        SELECT
          COALESCE(type_premier_evenement, 'Non renseigné') AS type,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (
            WHERE ${normalizedSql('recuperation_complete')} = 'oui'
          )::int AS recuperation_complete
        FROM sep_presentation_initiale
        GROUP BY type_premier_evenement
        ORDER BY count DESC
      `),

      // --- SEP : répartition des lignes thérapeutiques (traitement de fond en cours) ---
      pool.query(`
        SELECT ligne_therapeutique, COUNT(DISTINCT pseudonyme)::int AS count
        FROM sep_traitement_fond
        WHERE ligne_therapeutique IS NOT NULL AND date_fin IS NULL
        GROUP BY ligne_therapeutique
        ORDER BY ligne_therapeutique
      `),

      // --- SEP : motifs de switch thérapeutique les plus fréquents ---
      pool.query(`
        SELECT motif_switch, COUNT(*)::int AS count
        FROM sep_traitement_fond
        WHERE motif_switch IS NOT NULL
        GROUP BY motif_switch
        ORDER BY count DESC
        LIMIT 5
      `),

      // --- SEP : % de consanguinité parentale ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(TRIM(consanguinite_parentale::text)) IN ('oui', 'true', 't', '1'))::int AS positifs,
          COUNT(*)::int AS total
        FROM sep_antecedents
      `),

      // --- SEP : délai moyen avant conversion en forme secondairement progressive ---
      pool.query(`
        SELECT ROUND(AVG(date_conversion_sp - id.date_diagnostic) / 30.44, 1) AS delai_moyen_mois
        FROM sep_evolution ev
        JOIN sep_identification_clinique id USING (pseudonyme)
        WHERE date_conversion_sp IS NOT NULL AND id.date_diagnostic IS NOT NULL
      `),
    ]);

    res.json({
      gouvernoratRepartition: gouvernoratRepartition.rows,
      delaiDiagnosticMoyen: sepDelaiDiagnostic.rows[0]?.moyenne,
      formesEvolutives: sepFormesEvolutives.rows,
      edssMoyen: sepEdssRecent.rows[0]?.moyenne,
      edssNbPatients: sepEdssRecent.rows[0]?.nb_patients ?? 0,
      pousseesRecentes90j: sepPousseesRecentes.rows[0]?.count ?? 0,
      traitementsActifs: sepTraitementsActifs.rows[0]?.count ?? 0,
      activiteIrm: sepActiviteIrm.rows[0],
      bandesOligoclonales: sepBandesOligoclonales.rows[0],
      presentationInitiale: sepPresentationInitiale.rows,
      lignesTherapeutiques: sepLignesTherapeutiques.rows,
      motifsSwitch: sepMotifsSwitch.rows,
      consanguinite: sepConsanguinite.rows[0],
      delaiConversionSpMois: sepDelaiConversionSp.rows[0]?.delai_moyen_mois,
    });
  } catch (err) {
    console.error('Erreur getClinicienRegistreSep :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienRegistreSep };

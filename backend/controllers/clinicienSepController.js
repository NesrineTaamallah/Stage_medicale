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
      sepEdssTendance,
      sepTapAnnuel,
      sepImpactScolaireCognitif,
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

      // --- SEP : EDSS moyen de la cohorte, par trimestre (24 derniers mois).
      //     generate_series force l'apparition de TOUS les trimestres de la
      //     fenêtre, y compris ceux sans donnée (edss_moyen = NULL, nb_patients
      //     = 0) — sans quoi un trimestre vide disparaît silencieusement du
      //     graphe et son point est relié au trimestre suivant comme s'ils
      //     étaient consécutifs. nb_patients est renvoyé pour signaler côté
      //     UI qu'une moyenne reposant sur 1-2 patients n'a pas le même poids
      //     qu'une moyenne sur toute la cohorte. ---
      pool.query(`
        SELECT
          to_char(q, 'YYYY-"T"Q') AS periode,
          ROUND(AVG(v.score_edss)::numeric, 2) AS edss_moyen,
          COUNT(DISTINCT v.pseudonyme)::int AS nb_patients
        FROM generate_series(
          date_trunc('quarter', now()) - interval '21 months',
          date_trunc('quarter', now()),
          interval '3 months'
        ) q
        LEFT JOIN sep_edss_visites v
          ON date_trunc('quarter', v.date_visite) = q
          AND v.score_edss IS NOT NULL
        GROUP BY q
        ORDER BY q
      `),

      // --- SEP : Taux Annualisé de Poussées (TAP), moyenne de cohorte par
      //     année civile — réutilise la vue analytics.v_sep_tap_annuel déjà
      //     définie dans schema_registre.sql (jusqu'ici jamais exploitée).
      //     generate_series force l'apparition des 3 dernières années même
      //     sans aucune poussée enregistrée (tap_moyen = NULL, nb_patients = 0),
      //     pour la même raison que la correction sur l'EDSS trimestriel. ---
      pool.query(`
        SELECT
          y::int AS annee,
          ROUND(AVG(v.tap)::numeric, 2) AS tap_moyen,
          COUNT(DISTINCT v.pseudonyme)::int AS nb_patients
        FROM generate_series(
          EXTRACT(YEAR FROM now())::int - 2,
          EXTRACT(YEAR FROM now())::int
        ) y
        LEFT JOIN analytics.v_sep_tap_annuel v ON v.annee = y
        GROUP BY y
        ORDER BY y
      `),

      // --- SEP : impact scolaire/cognitif rapporté — sep_suivi.impact_scolaire_cognitif
      //     et score_cognitif n'apparaissaient jusqu'ici nulle part côté dashboard,
      //     alors qu'en pédiatrie l'impact cognitif est souvent plus parlant pour
      //     le suivi au quotidien que l'EDSS moteur seul. score_cognitif_non_applicable
      //     distingue "non testable selon l'âge" de "jamais évalué". ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE impact_scolaire_cognitif = TRUE)::int AS impact_positif,
          COUNT(*) FILTER (WHERE impact_scolaire_cognitif IS NOT NULL)::int AS total_renseignes,
          ROUND(AVG(score_cognitif) FILTER (WHERE score_cognitif_non_applicable = FALSE)::numeric, 1) AS score_cognitif_moyen,
          COUNT(*) FILTER (WHERE score_cognitif IS NOT NULL AND score_cognitif_non_applicable = FALSE)::int AS score_cognitif_nb_evalues,
          COUNT(*) FILTER (WHERE score_cognitif_non_applicable = TRUE)::int AS score_cognitif_non_applicable
        FROM sep_suivi
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
      edssTendance: sepEdssTendance.rows,
      tapAnnuel: sepTapAnnuel.rows,
      impactScolaireCognitif: sepImpactScolaireCognitif.rows[0],
    });
  } catch (err) {
    console.error('Erreur getClinicienRegistreSep :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienRegistreSep };

const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');


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
      sepSerologieDifferentielle,
      sepAtcdFamiliauxAutoImmuns,
      sepObservance,
    ] = await Promise.all([
      
      pool.query(`
        SELECT COALESCE(gouvernorat_code, 'Non renseigné') AS gouvernorat, COUNT(*)::int AS count
        FROM sep_identification_clinique
        GROUP BY gouvernorat_code
        ORDER BY count DESC
      `),

      pool.query(`SELECT ROUND(AVG(delai_diagnostic_mois)::numeric, 1) AS moyenne FROM sep_identification_clinique WHERE delai_diagnostic_mois IS NOT NULL`),

      pool.query(`
        SELECT COALESCE(forme_evolutive, 'Non renseigné') AS forme, COUNT(*)::int AS count
        FROM sep_evolution
        GROUP BY forme_evolutive
      `),

      pool.query(`
        SELECT ROUND(AVG(score_edss)::numeric, 1) AS moyenne, COUNT(*)::int AS nb_patients
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, score_edss
          FROM sep_edss_visites
          WHERE score_edss IS NOT NULL
          ORDER BY pseudonyme, date_visite DESC
        ) dernier
      `),

      pool.query(`SELECT COUNT(*)::int AS count FROM sep_poussees WHERE date_poussee >= now() - interval '90 days'`),

      pool.query(`
        SELECT COUNT(DISTINCT pseudonyme)::int AS count
        FROM sep_traitement_fond
        WHERE date_fin IS NULL
      `),

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

      pool.query(`
        SELECT ligne_therapeutique, COUNT(DISTINCT pseudonyme)::int AS count
        FROM sep_traitement_fond
        WHERE ligne_therapeutique IS NOT NULL AND date_fin IS NULL
        GROUP BY ligne_therapeutique
        ORDER BY ligne_therapeutique
      `),

      pool.query(`
        SELECT motif_switch, COUNT(*)::int AS count
        FROM sep_traitement_fond
        WHERE motif_switch IS NOT NULL
        GROUP BY motif_switch
        ORDER BY count DESC
        LIMIT 5
      `),

      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(TRIM(consanguinite_parentale::text)) IN ('oui', 'true', 't', '1'))::int AS positifs,
          COUNT(*)::int AS total
        FROM sep_antecedents
      `),

      pool.query(`
        SELECT ROUND(AVG(date_conversion_sp - id.date_diagnostic) / 30.44, 1) AS delai_moyen_mois
        FROM sep_evolution ev
        JOIN sep_identification_clinique id USING (pseudonyme)
        WHERE date_conversion_sp IS NOT NULL AND id.date_diagnostic IS NOT NULL
      `),

      
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

      
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE impact_scolaire_cognitif = TRUE)::int AS impact_positif,
          COUNT(*) FILTER (WHERE impact_scolaire_cognitif IS NOT NULL)::int AS total_renseignes,
          ROUND(AVG(score_cognitif) FILTER (WHERE score_cognitif_non_applicable = FALSE)::numeric, 1) AS score_cognitif_moyen,
          COUNT(*) FILTER (WHERE score_cognitif IS NOT NULL AND score_cognitif_non_applicable = FALSE)::int AS score_cognitif_nb_evalues,
          COUNT(*) FILTER (WHERE score_cognitif_non_applicable = TRUE)::int AS score_cognitif_non_applicable
        FROM sep_suivi
      `),

      
      pool.query(`
        SELECT COALESCE(NULLIF(TRIM(anticorps_type), ''), 'Non recherché / négatif') AS type, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, anticorps_type
          FROM sep_biologie_lcr
          ORDER BY pseudonyme, date_prelevement DESC
        ) dernier
        GROUP BY type
        ORDER BY count DESC
      `),

      
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE atcd_familiaux_auto_immuns_neuro = TRUE)::int AS positifs,
          COUNT(*) FILTER (WHERE atcd_familiaux_auto_immuns_neuro IS NOT NULL)::int AS total
        FROM sep_antecedents
      `),

      
      pool.query(`
        SELECT COALESCE(NULLIF(TRIM(observance), ''), 'Non renseigné') AS observance, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, observance
          FROM sep_traitement_fond
          WHERE date_fin IS NULL
          ORDER BY pseudonyme, date_debut DESC
        ) actif
        GROUP BY observance
        ORDER BY count DESC
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
      serologieDifferentielle: sepSerologieDifferentielle.rows,
      atcdFamiliauxAutoImmuns: sepAtcdFamiliauxAutoImmuns.rows[0],
      observanceTherapeutique: sepObservance.rows,
    });
  } catch (err) {
    console.error('Erreur getClinicienRegistreSep :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienRegistreSep };

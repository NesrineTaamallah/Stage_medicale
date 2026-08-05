const pool = require('../config/db');

const RECENT_ACTIVITY_ACTIONS = [
  { prefix: 'coordonnee_patient_reveal', label: 'Fiche patient consultée' },
  { prefix: 'analyse_statistique', label: 'Analyse statistique lancée' },
];

function labelForAction(action) {
  const match = RECENT_ACTIVITY_ACTIONS.find((a) => action.startsWith(a.prefix));
  return match ? match.label : action;
}

/**
 * GET /api/clinicien/overview
 * Alimente l'onglet "Vue d'Ensemble" du dashboard clinicien : KPI globaux,
 * courbe des inclusions, répartition géographique (SEP), statut de suivi,
 * et flux d'activité propre au clinicien connecté (req.user.sub).
 */
async function getClinicienOverview(req, res) {
  try {
    const [
      totals,
      sexeRepartition,
      ageRepartition,
      fichesIdentite,
      inclusionsByMonth,
      gouvernoratRepartition,
      statutSuiviSep,
      statutSuiviEpr,
      // --- Bloc SEP ---
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
      // --- Bloc EPR ---
      eprPharmacoresistance,
      eprEtiologies,
      eprFrequenceCrises,
      eprTypesCrise,
      eprAgeDebutCrises,
      eprAgeDiagnosticPharmacoresistance,
      eprDureeSuivi,
      // --- Alertes ---
      alertesSuiviEnRetard,
      alertesIrmAncienne,
      alertesTraitementsEcheance,
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
      pool.query(`
        SELECT COALESCE(sexe, 'Non renseigné') AS sexe, COUNT(*)::int AS count
        FROM patients
        GROUP BY sexe
      `),

      // --- Répartition par tranche d'âge ---
      pool.query(`
        SELECT
          CASE
            WHEN age IS NULL THEN 'Non renseigné'
            WHEN age < 2 THEN '0-2 ans'
            WHEN age < 6 THEN '2-6 ans'
            WHEN age < 12 THEN '6-12 ans'
            WHEN age < 18 THEN '12-18 ans'
            ELSE '18 ans et +'
          END AS tranche,
          COUNT(*)::int AS count
        FROM patients
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

      // --- Répartition par gouvernorat (registre SEP uniquement — seul registre
      //     qui capture ce champ actuellement) ---
      pool.query(`
        SELECT COALESCE(gouvernorat_code, 'Non renseigné') AS gouvernorat, COUNT(*)::int AS count
        FROM sep_identification_clinique
        GROUP BY gouvernorat_code
        ORDER BY count DESC
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
          COUNT(*) FILTER (WHERE LOWER(TRIM(bandes_oligoclonales::text)) IN ('oui', 'true', 't', '1'))::int AS positifs,
          COUNT(*)::int AS total
        FROM (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, bandes_oligoclonales
          FROM sep_biologie_lcr
          WHERE bandes_oligoclonales IS NOT NULL
          ORDER BY pseudonyme, date_prelevement DESC
        ) dernier
      `),

      // --- SEP : présentation initiale (type de 1er événement + récupération complète) ---
      pool.query(`
        SELECT
          COALESCE(type_premier_evenement, 'Non renseigné') AS type,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE recuperation_complete = 'oui')::int AS recuperation_complete
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

      // --- Alerte : suivi "actif" mais dernier point de suivi ancien (> 6 mois) ---
      pool.query(`
        SELECT COUNT(*)::int AS count FROM (
          SELECT date_dernier_suivi FROM sep_suivi WHERE statut_dernier_suivi = 'actif' AND date_dernier_suivi < now() - interval '6 months'
          UNION ALL
          SELECT NULL FROM epr_suivi WHERE statut_dernier_suivi = 'actif'
        ) s
        WHERE s.date_dernier_suivi IS NOT NULL
      `),

      // --- Alerte SEP : pas d'IRM depuis plus de 12 mois (patients avec au moins une IRM) ---
      pool.query(`
        SELECT COUNT(*)::int AS count FROM (
          SELECT pseudonyme, MAX(date_examen) AS derniere
          FROM sep_irm
          GROUP BY pseudonyme
        ) d
        WHERE derniere < now() - interval '12 months'
      `),

      // --- Alerte SEP : traitement de fond arrivant à échéance sous 30 jours ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM sep_traitement_fond
        WHERE date_fin IS NOT NULL
          AND date_fin BETWEEN now() AND now() + interval '30 days'
      `),

      // --- Activité récente du clinicien connecté, agrégée par jour ---
      // Le graphe (DailyStackedBarChart) attend un tableau de 7 objets
      // { day: 'YYYY-MM-DD', fiches_consultees: n, analyses_lancees: n },
      // un par jour sur les 7 derniers jours (y compris les jours à 0),
      // et non une liste plate de logs individuels.
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
      fichesIdentite: fichesIdentite.rows[0],
      inclusionsByMonth: inclusionsByMonth.rows,
      gouvernoratRepartition: gouvernoratRepartition.rows,
      comparatifSuivi: {
        sep: statutSuiviSep.rows,
        epr: statutSuiviEpr.rows,
      },
      sep: {
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
      },
      epr: {
        pharmacoresistance: eprPharmacoresistance.rows[0],
        etiologies: eprEtiologies.rows,
        frequenceCrisesMoyenne: eprFrequenceCrises.rows[0]?.moyenne,
        typesCrise: eprTypesCrise.rows,
        ageDebutCrisesMoyenMois: eprAgeDebutCrises.rows[0]?.moyenne,
        ageDiagnosticPharmacoresistanceMoyenMois: eprAgeDiagnosticPharmacoresistance.rows[0]?.moyenne,
        dureeSuiviMoyenneMois: eprDureeSuivi.rows[0]?.moyenne,
      },
      alertes: {
        suiviEnRetard: alertesSuiviEnRetard.rows[0]?.count ?? 0,
        irmAncienne: alertesIrmAncienne.rows[0]?.count ?? 0,
        traitementsEcheance: alertesTraitementsEcheance.rows[0]?.count ?? 0,
      },
      // Déjà au bon format : [{ day, fiches_consultees, analyses_lancees }, ...]
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

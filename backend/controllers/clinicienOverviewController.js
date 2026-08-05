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
 * Normalise un fragment SQL texte : accents retirés (via translate sur les
 * accents français courants), espaces superflus supprimés, casse uniformisée.
 * Utilisé pour toute comparaison de valeur catégorielle saisie librement
 * (Oui/oui/OUI, Positif/positif, Décédé/decede, etc.) sans jamais modifier
 * le schéma imposé — uniquement au niveau des requêtes.
 */
const UNACCENT_SQL = `translate(
  LOWER(TRIM(%COL%::text)),
  'àâäéèêëïîôöùûüçÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ',
  'aaaeeeeiioouucaaaeeeeiioouuc'
)`;
function normalizedSql(column) {
  return UNACCENT_SQL.replace(/%COL%/g, column);
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
      eprRegressionDeveloppementale,
      eprEligibiliteChirurgicale,
      eprEvolutionPostChirurgie,
      eprComorbiditesNeuropsy,
      // --- Alertes ---
      alertesSuiviEnRetard,
      alertesIrmAncienne,
      alertesTraitementsEcheance,
      alertesEegAncien,
      alertesBilanMultidisciplinaireAbsent,
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
      // NOTE (nouveau schéma) : la colonne 'sexe' n'existe plus sur `patients`,
      // elle vit désormais uniquement dans `sep_identification_clinique`.
      // Le registre EPR n'a pas d'équivalent -> ces patients tombent dans
      // 'Non renseigné' via le LEFT JOIN.
      // NOTE (correction) : le GROUP BY portait sur ic.sexe brut, donc des
      // variantes de casse/espaces ('M', 'm', ' M') auraient créé des lignes
      // distinctes au lieu d'être fusionnées. On groupe désormais sur la
      // valeur normalisée effectivement affichée.
      pool.query(`
        SELECT COALESCE(NULLIF(TRIM(ic.sexe), ''), 'Non renseigné') AS sexe, COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN sep_identification_clinique ic ON ic.pseudonyme = p.pseudonyme
        GROUP BY COALESCE(NULLIF(TRIM(ic.sexe), ''), 'Non renseigné')
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
      // NOTE (correction) : bandes_oligoclonales est un VARCHAR "Positif / Négatif"
      // (cf. schema_registre.sql). L'ancienne requête ne cherchait que
      // 'oui'/'true'/'t'/'1' et ne matchait donc jamais 'Positif' : le taux
      // affiché était systématiquement 0, quelle que soit la réalité clinique.
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
      // NOTE (correction) : recuperation_complete est un VARCHAR libre
      // (Oui / Non / Partielle). La comparaison stricte '= oui' ratait toute
      // variante de casse ('Oui', 'OUI'). Normalisation appliquée ici.
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

      // --- EPR : % de pharmacorésistance confirmée ---
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE LOWER(TRIM(statut_pharmacoresistance_confirme::text)) IN ('oui', 'true', 't', '1'))::int AS confirmes,
          COUNT(*)::int AS total
        FROM epr_pharmacoresistance
      `),

      // --- EPR : répartition des étiologies ---
      // NOTE (nouveau schéma) : epr_etiologie est désormais une table répétée
      // (1-N par patient), avec une seule ligne etiologie_principale = TRUE
      // par patient (contrainte uq_etiologie_principale). Sans ce filtre,
      // un patient ayant plusieurs lignes serait compté plusieurs fois.
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
      // NOTE (nouvelle recommandation) : la régression développementale est un
      // signal d'alerte pédiatrique majeur (oriente vers une encéphalopathie
      // épileptique / étiologie génétique) et n'était jusqu'ici jamais
      // remontée dans le tableau de bord clinicien alors que la table existe.
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE presence_regression = TRUE)::int AS positifs,
          COUNT(*) FILTER (WHERE presence_regression IS NOT NULL)::int AS total
        FROM epr_regression_developpementale
      `),

      // --- EPR : éligibilité chirurgicale parmi les patients ayant eu un bilan
      //     pré-chirurgical (un patient peut avoir plusieurs bilans -> on ne
      //     retient que le plus récent) ---
      // NOTE (correction) : total_evalues comptait aussi les bilans où
      // eligibilite_chirurgie est NULL (champ non renseigné sur ce bilan),
      // ce qui gonflait artificiellement le dénominateur et sous-estimait le
      // taux affiché — même défaut que celui déjà corrigé sur pct()/pctLabel
      // côté frontend pour un dénominateur nul.
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
      //     patient) — TSA/TDAH, troubles du comportement, troubles du sommeil.
      //     Ces champs existent dans le schéma mais n'étaient exploités nulle
      //     part : ils sont pourtant centraux dans la prise en charge globale
      //     de l'enfant épileptique pharmacorésistant. ---
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

      // --- Alerte : suivi toujours en cours mais dernier point de suivi ancien (> 6 mois) ---
      // NOTE (correction) : le statut réel n'est jamais 'actif' (cf.
      // schema_registre.sql : SEP = Stable / Perdu de vue / Décédé ;
      // EPR = Libre de crises / Épilepsie active / Perdu de vue). Un patient
      // est considéré "en suivi" tant qu'il n'est ni perdu de vue ni décédé.
      // - SEP : sep_suivi possède bien date_dernier_suivi -> comparaison directe.
      // - EPR : epr_suivi n'a AUCUNE colonne de date (schéma imposé). On estime
      //   donc la date de dernière activité comme la plus récente parmi les
      //   dates disponibles dans les tables cliniques EPR (GREATEST des MAX
      //   par patient). Si aucune date n'existe, le patient est exclu du
      //   comptage plutôt que compté à tort comme "à jour".
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
      // NOTE (correction) : l'ancienne requête partait de sep_irm, donc un
      // patient SEP sans aucune IRM n'apparaissait dans aucune ligne et
      // n'était jamais compté dans l'alerte — c'est pourtant le cas le plus
      // grave (patient totalement non exploré). On part maintenant de la
      // table patients avec un LEFT JOIN.
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
      //     patients n'ayant JAMAIS eu d'EEG (même logique que l'alerte IRM
      //     SEP ci-dessus — jusqu'ici l'EPR n'avait aucune alerte de suivi
      //     paraclinique alors que l'EEG est l'examen de surveillance central
      //     de l'épilepsie pharmacorésistante). ---
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
      //     ergothérapie) jamais réalisé — repère les patients pharmacorésistants
      //     suivis uniquement sur le plan neurologique, sans évaluation globale
      //     du développement, alors que ces trois bilans existent dans le
      //     schéma sans jamais être croisés avec la patientèle totale. ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN epr_bilan_neuropsy bn ON bn.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_orthophonique bo ON bo.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_ergotherapique be ON be.pseudonyme = p.pseudonyme
        WHERE p.registre = 'EPR'
          AND bn.pseudonyme IS NULL AND bo.pseudonyme IS NULL AND be.pseudonyme IS NULL
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
        regressionDeveloppementale: eprRegressionDeveloppementale.rows[0],
        eligibiliteChirurgicale: eprEligibiliteChirurgicale.rows[0],
        evolutionPostChirurgie: eprEvolutionPostChirurgie.rows,
        comorbiditesNeuropsy: eprComorbiditesNeuropsy.rows[0],
      },
      alertes: {
        suiviEnRetard: alertesSuiviEnRetard.rows[0]?.count ?? 0,
        irmAncienne: alertesIrmAncienne.rows[0]?.count ?? 0,
        traitementsEcheance: alertesTraitementsEcheance.rows[0]?.count ?? 0,
        eegAncien: alertesEegAncien.rows[0]?.count ?? 0,
        bilanMultidisciplinaireAbsent: alertesBilanMultidisciplinaireAbsent.rows[0]?.count ?? 0,
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

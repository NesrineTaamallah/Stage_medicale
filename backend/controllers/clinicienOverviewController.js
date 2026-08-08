const pool = require('../config/db');
const { normalizedSql } = require('../utils/clinicienSql');
const { decrypt } = require('../utils/cryptoUtils');
const { logAccess } = require('../utils/accessLog');

/**
 * Parse une date_naissance déchiffrée, saisie soit en 'YYYY-MM-DD' soit en
 * 'DD/MM/YYYY' selon la source d'import (cf. insert_sep_data.sql vs
 * coordonnee_patient_seed.sql) — renvoie null si non exploitable.
 */
function parseDateNaissance(raw) {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (fr) return new Date(Date.UTC(+fr[3], +fr[2] - 1, +fr[1]));
  return null;
}

function ageEnAnnees(dateNaissance, reference = new Date()) {
  let age = reference.getUTCFullYear() - dateNaissance.getUTCFullYear();
  const moisJourDepasses =
    reference.getUTCMonth() > dateNaissance.getUTCMonth() ||
    (reference.getUTCMonth() === dateNaissance.getUTCMonth() &&
      reference.getUTCDate() >= dateNaissance.getUTCDate());
  if (!moisJourDepasses) age -= 1;
  return age;
}

function trancheDe(age) {
  if (age === null || age === undefined) return 'Non renseigné';
  if (age < 2) return '0-2 ans';
  if (age < 6) return '2-6 ans';
  if (age < 12) return '6-12 ans';
  if (age < 18) return '12-18 ans';
  return '18 ans et +';
}

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
      alertesActiviteMaladieSep,
      alertesPharmacoresistanceSansEvaluationEpr,
      recentActivity,
      suiviQualite,
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

      // --- Répartition par sexe (SEP + EPR) ---
      // Depuis migration_epr_sexe.sql, epr_identification_clinique porte
      // aussi la colonne 'sexe' (symétrique de sep_identification_clinique) :
      // le donut peut donc couvrir les deux registres sans artefact de
      // schéma. UNION ALL plutôt qu'un JOIN unique car les deux tables ne
      // partagent pas le même nom de PK de table source.
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(sexe), ''), 'Non renseigné') AS sexe,
          COUNT(*)::int AS count
        FROM (
          SELECT ic.sexe FROM patients p
          JOIN sep_identification_clinique ic ON ic.pseudonyme = p.pseudonyme
          WHERE p.registre = 'SEP'
          UNION ALL
          SELECT ic.sexe FROM patients p
          JOIN epr_identification_clinique ic ON ic.pseudonyme = p.pseudonyme
          WHERE p.registre = 'EPR'
        ) both_registres
        GROUP BY 1
      `),

      // --- Fiches sans extraction des données patient ---
      // Un patient compte comme "en attente d'extraction" s'il a au moins un
      // document dont le texte a été validé (texte_transcrit renseigné) mais
      // qui n'a pas encore servi à extraire les coordonnées
      // (coordonnees_extraites = false, cf. documents_bruts). Un document
      // simplement "valide" n'a pas encore d'extraction ; dès que
      // l'extraction est faite et enregistrée (coordonnees_extraites =
      // true), il ne compte plus. Remplace l'ancienne définition basée sur
      // la seule présence d'une ligne dans coordonnee_patient, qui ne
      // reflétait pas les documents ajoutés après coup à un dossier déjà
      // renseigné.
      pool.query(`
        SELECT
          COUNT(DISTINCT p.pseudonyme)::int AS total_patients,
          COUNT(DISTINCT p.pseudonyme) FILTER (WHERE d.id IS NULL)::int AS patients_sans_extraction_en_attente,
          COUNT(DISTINCT p.pseudonyme) FILTER (WHERE d.id IS NOT NULL)::int AS patients_avec_extraction_en_attente
        FROM patients p
        LEFT JOIN documents_bruts d
          ON d.pseudonyme = p.pseudonyme
         AND d.texte_transcrit IS NOT NULL
         AND TRIM(d.texte_transcrit) <> ''
         AND d.coordonnees_extraites = false
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

      // --- Alerte clinique SEP : évidence d'activité de la maladie (EDA),
      //     critère NEDA-3 inversé (Giovannoni et al. 2017 ; standard de suivi
      //     SEP le plus répandu). Reprend EXACTEMENT la même condition que
      //     clinicienEntitesController.js (type 'activiteMaladieSep'). ---
      pool.query(`
        WITH edss_ordered AS (
          SELECT pseudonyme, score_edss, date_visite,
                 ROW_NUMBER() OVER (PARTITION BY pseudonyme ORDER BY date_visite DESC) AS rn
          FROM sep_edss_visites
          WHERE score_edss IS NOT NULL
        ),
        edss_progression AS (
          SELECT a.pseudonyme, (a.score_edss - b.score_edss) AS delta, b.score_edss AS score_reference
          FROM edss_ordered a
          JOIN edss_ordered b ON b.pseudonyme = a.pseudonyme AND b.rn = 2
          WHERE a.rn = 1
        ),
        irm_recente AS (
          SELECT DISTINCT ON (pseudonyme) pseudonyme, date_examen, nouvelles_lesions_vs_irm_anterieure
          FROM sep_irm
          ORDER BY pseudonyme, date_examen DESC
        ),
        derniere_poussee AS (
          SELECT pseudonyme, MAX(date_poussee) AS derniere_poussee FROM sep_poussees GROUP BY pseudonyme
        )
        SELECT COUNT(*)::int AS count
        FROM patients p
        JOIN sep_suivi s ON s.pseudonyme = p.pseudonyme
        LEFT JOIN derniere_poussee dp ON dp.pseudonyme = p.pseudonyme
        LEFT JOIN irm_recente irm ON irm.pseudonyme = p.pseudonyme
        LEFT JOIN edss_progression edp ON edp.pseudonyme = p.pseudonyme
        WHERE p.registre = 'SEP'
          AND ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
          AND (
            (dp.derniere_poussee >= now() - interval '12 months')
            OR (irm.nouvelles_lesions_vs_irm_anterieure AND irm.date_examen >= now() - interval '12 months')
            OR (edp.delta IS NOT NULL AND (
                  (edp.score_reference <= 5.5 AND edp.delta >= 1)
               OR (edp.score_reference > 5.5 AND edp.delta >= 0.5)
            ))
          )
      `),

      // --- Alerte clinique EPR : pharmacorésistance confirmée (critère ILAE
      //     2010) mais aucun bilan pré-chirurgical enregistré — recommandation
      //     ILAE = référer sans délai. Reprend EXACTEMENT la même condition
      //     que clinicienEntitesController.js (type 'pharmacoresistanceSansEvaluationEpr'). ---
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        JOIN epr_pharmacoresistance epr ON epr.pseudonyme = p.pseudonyme
        LEFT JOIN epr_bilan_prechirurgical bp ON bp.pseudonyme = p.pseudonyme
        WHERE p.registre = 'EPR'
          AND epr.statut_pharmacoresistance_confirme = TRUE
          AND bp.pseudonyme IS NULL
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

      // --- Indicateur de qualité de suivi agrégé ("% patients à jour") ---
      // Inspiré des indicateurs de qualité standard des registres SEP de
      // référence (EDSS/IRM tous les 6-12 mois, cf. registres suédois et
      // italien) : plutôt que des alertes patient par patient uniquement,
      // un score global donne au clinicien un baromètre de la qualité de
      // suivi de sa cohorte active. "À jour" = EDSS ET IRM < 12 mois (SEP),
      // EEG ET fréquence de crises rapportée < 12 mois (EPR), parmi les
      // patients en suivi actif (hors perdu de vue / décédé).
      pool.query(`
        WITH sep_actifs AS (
          SELECT s.pseudonyme
          FROM sep_suivi s
          WHERE ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
        ),
        sep_a_jour AS (
          SELECT a.pseudonyme
          FROM sep_actifs a
          JOIN (SELECT pseudonyme, MAX(date_visite) AS d FROM sep_edss_visites GROUP BY pseudonyme) edss
            ON edss.pseudonyme = a.pseudonyme AND edss.d >= now() - interval '12 months'
          JOIN (SELECT pseudonyme, MAX(date_examen) AS d FROM sep_irm GROUP BY pseudonyme) irm
            ON irm.pseudonyme = a.pseudonyme AND irm.d >= now() - interval '12 months'
        ),
        epr_actifs AS (
          SELECT s.pseudonyme
          FROM epr_suivi s
          WHERE ${normalizedSql('s.statut_dernier_suivi')} NOT IN ('perdu de vue', 'decede')
        ),
        epr_a_jour AS (
          SELECT a.pseudonyme
          FROM epr_actifs a
          JOIN (SELECT pseudonyme, MAX(date_eeg) AS d FROM epr_eeg GROUP BY pseudonyme) eeg
            ON eeg.pseudonyme = a.pseudonyme AND eeg.d >= now() - interval '12 months'
          JOIN (SELECT pseudonyme, MAX(date_rapport) AS d FROM epr_frequence_crises GROUP BY pseudonyme) fc
            ON fc.pseudonyme = a.pseudonyme AND fc.d >= now() - interval '12 months'
        )
        SELECT
          (SELECT COUNT(*) FROM sep_actifs)::int AS sep_actifs_total,
          (SELECT COUNT(*) FROM sep_a_jour)::int AS sep_a_jour,
          (SELECT COUNT(*) FROM epr_actifs)::int AS epr_actifs_total,
          (SELECT COUNT(*) FROM epr_a_jour)::int AS epr_a_jour
      `),
    ]);

    // --- Répartition par tranche d'âge ---
    // Âge exact calculé à partir de date_naissance (coordonnee_patient),
    // déchiffrée côté Node — ce champ est chiffré en base et ne peut pas
    // être exploité dans une clause SQL. Repli sur 'age' brut (patients,
    // saisi à l'inclusion, non chiffré) pour les patients sans fiche
    // coordonnee_patient ou avec une date_naissance illisible.
    // Accès en masse à des données identifiantes -> journalisé comme un
    // reveal, au même titre que /api/coordonnees/reveal.
    const ageRows = await pool.query(`
      SELECT p.pseudonyme, p.age, cp.date_naissance
      FROM patients p
      LEFT JOIN coordonnee_patient cp ON cp.pseudonyme = p.pseudonyme
    `);

    const tranchesCount = {};
    let dateNaissanceUtilisees = 0;

    for (const row of ageRows.rows) {
      let age = null;
      const dateNaissance = row.date_naissance ? parseDateNaissance(decrypt(row.date_naissance)) : null;

      if (dateNaissance) {
        age = ageEnAnnees(dateNaissance);
        dateNaissanceUtilisees += 1;
      } else if (row.age !== null && row.age !== undefined) {
        age = row.age; // repli : âge saisi à l'inclusion
      }

      const tranche = trancheDe(age);
      tranchesCount[tranche] = (tranchesCount[tranche] || 0) + 1;
    }

    const ageRepartitionRows = Object.entries(tranchesCount).map(([tranche, count]) => ({ tranche, count }));

    if (dateNaissanceUtilisees > 0) {
      await logAccess({
        userId: req.user.sub,
        action: 'coordonnee_patient_reveal_bulk_age',
        success: true,
        req,
      });
    }

    res.json({
      totals: totals.rows[0],
      sexeRepartition: sexeRepartition.rows,
      ageRepartition: ageRepartitionRows,
      ageEstimeApproximatif: false, // âge exact depuis date_naissance quand disponible, sinon repli sur age brut
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
        activiteMaladieSep: alertesActiviteMaladieSep.rows[0]?.count ?? 0,
        pharmacoresistanceSansEvaluationEpr: alertesPharmacoresistanceSansEvaluationEpr.rows[0]?.count ?? 0,
      },
      recentActivity: recentActivity.rows.map((r) => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
        fiches_consultees: r.fiches_consultees,
        analyses_lancees: r.analyses_lancees,
      })),
      suiviQualite: {
        sep: { aJour: suiviQualite.rows[0]?.sep_a_jour ?? 0, total: suiviQualite.rows[0]?.sep_actifs_total ?? 0 },
        epr: { aJour: suiviQualite.rows[0]?.epr_a_jour ?? 0, total: suiviQualite.rows[0]?.epr_actifs_total ?? 0 },
      },
    });
  } catch (err) {
    console.error('Erreur getClinicienOverview :', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
}

module.exports = { getClinicienOverview };
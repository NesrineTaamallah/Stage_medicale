

-- Table pivot commune aux deux registres (alimentée par la fenêtre 3)
CREATE TABLE IF NOT EXISTS patients (
    pseudonyme          VARCHAR(255) PRIMARY KEY,   -- sortie de la fonction de hashage
    registre             VARCHAR(10) NOT NULL CHECK (registre IN ('SEP', 'EPR')),
    date_inclusion        DATE,
    age                    NUMERIC,                  -- âge au moment de l'inclusion
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()


CREATE TABLE IF NOT EXISTS gouvernorats_reference (
    code                 VARCHAR(4) PRIMARY KEY,     -- ex: TUN, ARI, BEN...
    nom                    VARCHAR(100),
    latitude_centroide       NUMERIC,
    longitude_centroide        NUMERIC
);



CREATE TABLE IF NOT EXISTS sep_identification_clinique (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    sexe                          VARCHAR(10),                -- M / F
    gouvernorat_code               VARCHAR(4) REFERENCES gouvernorats_reference(code),
    date_diagnostic                 DATE,
    age_diagnostic_mois              NUMERIC,
    age_premier_symptome_mois         NUMERIC,
    delai_diagnostic_mois              NUMERIC GENERATED ALWAYS AS
        (age_diagnostic_mois - age_premier_symptome_mois) STORED   -- Correction v2 : calculé, plus saisi
);

CREATE TABLE IF NOT EXISTS sep_presentation_initiale (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    type_premier_evenement        VARCHAR(100),   -- névrite optique / myélite / tronc cérébral / polysymptomatique / ...
    recuperation_complete           VARCHAR(10)   -- Oui / Non / Partielle
);

CREATE TABLE IF NOT EXISTS sep_evolution (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    forme_evolutive                VARCHAR(50),   -- RR / SP / progressive d'emblée
    severite                         VARCHAR(50),   -- Hautement active / agressive
    date_conversion_sp                 DATE,
    date_conversion_sp_non_applicable    BOOLEAN NOT NULL DEFAULT FALSE  -- satellite NA (Priorité 5) : TRUE si patient resté en forme RR
);

CREATE TABLE IF NOT EXISTS sep_antecedents (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    atcd_familiaux_auto_immuns_neuro       BOOLEAN,
    atcd_familiaux_precision                 TEXT,          -- premier degré vs autre
    consanguinite_parentale                    BOOLEAN,
    consanguinite_degre                          TEXT,
    infections_vaccinations_avant_1er_episode      TEXT      -- facteur déclenchant potentiel
);

CREATE TABLE IF NOT EXISTS sep_edss_visites (
    id                    SERIAL PRIMARY KEY,
    pseudonyme              VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_visite               DATE NOT NULL,
    score_edss                  NUMERIC        -- 0 à 10
);
CREATE INDEX IF NOT EXISTS idx_sep_edss_pseudo ON sep_edss_visites(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_poussees (
    id                    SERIAL PRIMARY KEY,
    pseudonyme              VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_poussee               DATE NOT NULL,          -- permet calcul du TAP
    type_localisation             VARCHAR(100),
    traitement_poussee              VARCHAR(50),         -- corticoïdes / échanges plasmatiques
    sequelle_post_poussee             BOOLEAN,
    edss_associe                        NUMERIC          -- score EDSS associé à la séquelle
);
CREATE INDEX IF NOT EXISTS idx_sep_poussees_pseudo ON sep_poussees(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_irm (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen                    DATE NOT NULL,
    nb_lesions_t2                     INTEGER,
    cr_irm_texte                        TEXT,
    localisation_peri_ventriculaire       BOOLEAN,   -- critères de Barkhof
    localisation_juxta_corticale            BOOLEAN,   -- critères de Barkhof
    localisation_sous_tentorielle             BOOLEAN,   -- critères de Barkhof
    localisation_moelle                         BOOLEAN,   -- critères de Barkhof
    prise_contraste_gd                            BOOLEAN,
    nb_lesions_rehaussees                           INTEGER,  -- si Gd+
    nouvelles_lesions_vs_irm_anterieure               BOOLEAN,  -- activité radiologique
    atrophie_cerebrale_medullaire                       BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_sep_irm_pseudo ON sep_irm(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_biologie_lcr (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_prelevement               DATE,
    bandes_oligoclonales             VARCHAR(20),  -- Positif / Négatif (catégoriel — cf. analysis-service/sep/test5_lcr_survie_tap.py)
    index_chaines_kappa                VARCHAR(20),  -- Positif / Négatif
    index_igg                            NUMERIC,
    anticorps_type                         VARCHAR(50),  -- NMO-IgG/MOG / AQP4 / AAN / autres
    anticorps_autre_texte                    TEXT       -- si "autres"
);
CREATE INDEX IF NOT EXISTS idx_sep_lcr_pseudo ON sep_biologie_lcr(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_potentiels_evoques (
    id                SERIAL PRIMARY KEY,
    pseudonyme           VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen             DATE,
    pev                        VARCHAR(20),   -- Normal / Anormal
    pes                          VARCHAR(20),   -- Normal / Anormal
    pea                            VARCHAR(20),   -- Normal / Anormal
    anomalie_texte                   TEXT       -- si anormal
);
CREATE INDEX IF NOT EXISTS idx_sep_pe_pseudo ON sep_potentiels_evoques(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_traitement_fond (
    id                     SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    molecule                    VARCHAR(100),   -- interféron / natalizumab / fingolimod / etc.
    ligne_therapeutique            VARCHAR(20),    -- 1ère / 2ème ligne / ... (catégoriel — cf. test7_sep.py)
    date_debut                       DATE,
    date_fin                           DATE,
    motif_switch                          VARCHAR(100),  -- échec / effet indésirable / choix
    effets_indesirables                     TEXT,
    observance                                VARCHAR(20)    -- Oui / Non / Partielle
);
CREATE INDEX IF NOT EXISTS idx_sep_traitement_pseudo ON sep_traitement_fond(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_suivi (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    date_dernier_suivi             DATE,
    statut_dernier_suivi             VARCHAR(50),  -- Stable / Perdu de vue / Décédé
    score_edss_dernier                 NUMERIC,      -- 0 à 10
    impact_scolaire_cognitif             BOOLEAN,
    impact_precision                       TEXT,
    score_cognitif                           NUMERIC   -- si disponible
);


CREATE TABLE IF NOT EXISTS reference_groupe_efficacite (
    molecule            VARCHAR(100) PRIMARY KEY,
    groupe                VARCHAR(50) NOT NULL,      -- Faible_Moderee / Haute_efficacite
    classe_par              VARCHAR(255),               -- traçabilité : qui a classé la molécule
    date_classement            TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- REGISTRE EPR (Épilepsie Résistante pédiatrique)
-- ============================================================================

CREATE TABLE IF NOT EXISTS epr_identification_clinique (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    age_debut_crises_mois                  NUMERIC,
    age_diagnostic_pharmacoresistance_mois    NUMERIC   -- calculé selon définition ILAE
);

CREATE TABLE IF NOT EXISTS epr_antecedents (
    pseudonyme                                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    atcd_perinataux                                BOOLEAN,   -- souffrance, prématurité
    atcd_perinataux_precision                        TEXT,
    consanguinite_parentale                            BOOLEAN,
    consanguinite_degre                                  TEXT,
    atcd_familiaux_epilepsie                               BOOLEAN,
    atcd_familiaux_lien                                      TEXT,      -- arbre généalogique structuré
    developpement_psychomoteur_avant_crises                    VARCHAR(50)  -- Normal / Retard
);

CREATE TABLE IF NOT EXISTS epr_type_crise (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_observation            DATE,
    type_crise_ilae2017           VARCHAR(100),  -- Focale / Généralisée / Inconnue
    sous_type                       VARCHAR(100),
    facteurs_declenchants             TEXT           -- fièvre / privation de sommeil / vaccination / ... (checklist)
);
CREATE INDEX IF NOT EXISTS idx_epr_type_crise_pseudo ON epr_type_crise(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_frequence_crises (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_rapport                   DATE,       -- date de la consultation où la fréquence est rapportée
    periode_debut                    DATE,       -- début de la période couverte par la moyenne rapportée
    periode_fin                        DATE,       -- fin de la période couverte
    frequence_crises                     NUMERIC,    -- valeur brute telle que rapportée
    unite_frequence                        VARCHAR(20), -- crises/mois / crises/jour / crises/semaine
    frequence_normalisee_mois                NUMERIC GENERATED ALWAYS AS (
        CASE unite_frequence
            WHEN 'crises/jour' THEN frequence_crises * 30
            WHEN 'crises/semaine' THEN frequence_crises * 4.33
            ELSE frequence_crises
        END
    ) STORED,                                            -- Correction v2 : colonne pivot pour les analyses
    duree_moyenne_min                          NUMERIC   -- en minutes
);
CREATE INDEX IF NOT EXISTS idx_epr_freq_pseudo ON epr_frequence_crises(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_examen (
    id                              SERIAL PRIMARY KEY,
    pseudonyme                         VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen                           DATE,
    neuro_eveil_reactivite                   TEXT,
    neuro_langage                              TEXT,
    neuro_comportement                           TEXT,
    neuro_marche                                   TEXT,
    neuro_station_debout                             TEXT,
    neuro_tonus                                        TEXT,
    neuro_force_motrice                                  TEXT,
    neuro_reflexes                                         TEXT,
    neuro_mouvements_anormaux                                TEXT,
    poids_kg                                                   NUMERIC,
    taille_cm                                                    NUMERIC,
    perimetre_cranien_cm                                           NUMERIC,
    lesions_cutanees                                                 TEXT,
    deformations_osseuses                                              TEXT,
    dysmorphie_faciale                                                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_examen_pseudo ON epr_examen(pseudonyme);

-- Correction v3 / Priorité 2 : passée en table répétée (1-N) pour supporter
-- les étiologies combinées (ILAE 2017).
CREATE TABLE IF NOT EXISTS epr_etiologie (
    id                              SERIAL PRIMARY KEY,
    pseudonyme                         VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    categorie_etiologique                 VARCHAR(50),  -- Structurelle / Génétique / Métabolique / Infectieuse / Immune / Inconnue
    etiologie_principale                    BOOLEAN,      -- exactement une ligne TRUE par patient
    detail_lesion_structurelle                TEXT,         -- rempli seulement si Structurelle
    detail_gene_mute                            TEXT,         -- rempli seulement si Génétique
    detail_maladie_metabolique                    TEXT,         -- rempli seulement si Métabolique
    detail_facteur_infectieux                       TEXT,         -- rempli seulement si Infectieuse
    detail_maladie_auto_immune                        TEXT          -- rempli seulement si Immune
);
CREATE INDEX IF NOT EXISTS idx_epr_etiologie_pseudo ON epr_etiologie(pseudonyme);

-- Garantit qu'il n'existe qu'une seule étiologie "principale" par patient
CREATE UNIQUE INDEX IF NOT EXISTS uq_etiologie_principale
  ON epr_etiologie (pseudonyme)
  WHERE etiologie_principale = TRUE;

CREATE TABLE IF NOT EXISTS epr_regression_developpementale (
    pseudonyme            VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    presence_regression       BOOLEAN,
    date_observee                DATE
);

-- Correction 1 : nb_ae_essayes retiré — c'est un COUNT() sur epr_liste_ae,
-- pas une donnée saisie. Voir la vue v_epr_nb_ae ci-dessous.
CREATE TABLE IF NOT EXISTS epr_pharmacoresistance (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    statut_pharmacoresistance_confirme    BOOLEAN  -- définition ILAE = échec de 2 AE adaptés et bien tolérés
);

CREATE TABLE IF NOT EXISTS epr_liste_ae (
    id            SERIAL PRIMARY KEY,
    pseudonyme       VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    nom_ae              VARCHAR(100),
    dose                  TEXT,
    duree                   TEXT,
    reponse                    VARCHAR(50),  -- crises libres / réduction % / échec
    motif_echec                  VARCHAR(50)   -- Inefficacité / Effet indésirable
);
CREATE INDEX IF NOT EXISTS idx_epr_liste_ae_pseudo ON epr_liste_ae(pseudonyme);

-- Correction 1 : vue remplaçant epr_pharmacoresistance.nb_ae_essayes (colonne calculée)
CREATE OR REPLACE VIEW v_epr_nb_ae AS
SELECT pseudonyme, COUNT(*) AS nb_ae_essayes
FROM epr_liste_ae
GROUP BY pseudonyme;

CREATE TABLE IF NOT EXISTS epr_eeg (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                   VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_eeg                        DATE,
    eeg_intercritique                  VARCHAR(20),  -- Normal / Anormal
    type_anomalie                        VARCHAR(100), -- Pointes / pointes-ondes / ondes lentes / ralentissement focal / etc. ('NA' si eeg_intercritique = Normal)
    localisation_foyer                     TEXT,         -- ('NA' si normal)
    eeg_video_realise                        BOOLEAN,
    date_eeg_video                             DATE,
    type_crise_enregistree                       TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_eeg_pseudo ON epr_eeg(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_imagerie (
    id                            SERIAL PRIMARY KEY,
    pseudonyme                      VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen                        DATE,
    irm_cerebrale                         VARCHAR(20),  -- Normal / Anormal
    type_lesion                             VARCHAR(100), -- corrélation avec EEG ('NA' si irm_cerebrale = Normal)
    cr_detaille_texte                         TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_imagerie_pseudo ON epr_imagerie(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_genetique (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                   VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    gene_teste                      VARCHAR(100),  -- panel épilepsie, WES, etc.
    variant_identifie                 TEXT,
    classification_acmg                 VARCHAR(50),   -- Classe I / II / III / IV / ...
    mode_transmission                     VARCHAR(20)    -- AR / AD / lié X / de novo
);
CREATE INDEX IF NOT EXISTS idx_epr_genetique_pseudo ON epr_genetique(pseudonyme);

-- Contient uniquement le bilan/évaluation (répétable, plusieurs bilans possibles
-- avant décision). La chirurgie elle-même est dans epr_chirurgie (Correction 3).
CREATE TABLE IF NOT EXISTS epr_bilan_prechirurgical (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_bilan                  DATE,
    eligibilite_chirurgie          BOOLEAN,
    type_bilan_realise               TEXT   -- PET, IRM fonctionnelle, etc.
);
CREATE INDEX IF NOT EXISTS idx_epr_bilan_prechir_pseudo ON epr_bilan_prechirurgical(pseudonyme);

-- Nouvelle table (Correction 3) : un acte daté, distinct du bilan qui y mène.
CREATE TABLE IF NOT EXISTS epr_chirurgie (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                   VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    chirurgie_realisee              BOOLEAN,
    date_chirurgie                     DATE,
    type_chirurgie                       TEXT,
    evolution_post_chirurgie               VARCHAR(50)  -- Persistance des crises / Rémission totale / Diminution de la fréquence des crises
);
CREATE INDEX IF NOT EXISTS idx_epr_chirurgie_pseudo ON epr_chirurgie(pseudonyme);

-- Correction v3 : passée en table répétée avec dates de début (un patient peut
-- essayer plusieurs alternatives successivement).
CREATE TABLE IF NOT EXISTS epr_alternatives_therapeutiques (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    type_alternative            VARCHAR(50),  -- régime cétogène / VNS
    date_debut                     DATE,
    reponse                           TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_alt_therap_pseudo ON epr_alternatives_therapeutiques(pseudonyme);

-- Trois tables suivantes : extraites de l'ancien epr_bilan_multidisciplinaire,
-- chacune datée et indépendante (Correction v1, point 2).
CREATE TABLE IF NOT EXISTS epr_bilan_orthophonique (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_bilan                  DATE,
    bilan_orthophonique_texte      TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_bilan_ortho_pseudo ON epr_bilan_orthophonique(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_bilan_neuropsy (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_bilan                  DATE,
    qi                             NUMERIC,
    troubles_comportement            BOOLEAN,
    troubles_psy_associes              VARCHAR(20),  -- TSA / TDAH : Oui / Non / NA
    troubles_sphincteriens               VARCHAR(20),  -- Oui / Non / NA
    troubles_sommeil                       BOOLEAN,
    type_trouble_sommeil                     TEXT      -- si oui, type ('NA' si troubles_sommeil = Non)
);
CREATE INDEX IF NOT EXISTS idx_epr_bilan_neuropsy_pseudo ON epr_bilan_neuropsy(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_bilan_ergotherapique (
    id                    SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_bilan                  DATE,
    bilan_ergotherapique_texte     TEXT
);
CREATE INDEX IF NOT EXISTS idx_epr_bilan_ergo_pseudo ON epr_bilan_ergotherapique(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_suivi (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    statut_dernier_suivi           VARCHAR(50),  -- Libre de crises / Épilepsie active / Perdu de vue
    duree_suivi_mois                 NUMERIC       -- en mois
);



CREATE SCHEMA IF NOT EXISTS analytics;

-- Taux Annualisé de Poussées par patient et par année civile
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.v_sep_tap_annuel AS
SELECT
  pseudonyme,
  EXTRACT(YEAR FROM date_poussee) AS annee,
  COUNT(*) AS nb_poussees,
  COUNT(*)::NUMERIC / 1.0 AS tap
FROM sep_poussees
GROUP BY pseudonyme, EXTRACT(YEAR FROM date_poussee);

-- Dernier score EDSS connu par patient
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.v_sep_edss_dernier_connu AS
SELECT DISTINCT ON (pseudonyme)
  pseudonyme, date_visite AS date_dernier_edss, score_edss AS edss_dernier
FROM sep_edss_visites
ORDER BY pseudonyme, date_visite DESC;

-- Statut de pharmacorésistance recoupé avec le détail des AE essayés (définition ILAE)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.v_epr_pharmacoresistance_detail AS
SELECT
  p.pseudonyme,
  p.statut_pharmacoresistance_confirme AS statut_declare,
  COUNT(a.id) FILTER (WHERE a.motif_echec = 'Inefficacité') AS nb_echecs_inefficacite,
  COUNT(a.id) AS nb_ae_total,
  (COUNT(a.id) FILTER (WHERE a.motif_echec = 'Inefficacité') >= 2) AS statut_calcule_ilae
FROM epr_pharmacoresistance p
LEFT JOIN epr_liste_ae a ON a.pseudonyme = p.pseudonyme
GROUP BY p.pseudonyme, p.statut_pharmacoresistance_confirme;

-- Agrégation par étiologie principale (1 ligne par patient)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.v_epr_cohorte_etiologie AS
SELECT
  e.pseudonyme,
  e.categorie_etiologique AS etiologie_principale,
  s.duree_suivi_mois,
  s.statut_dernier_suivi
FROM epr_etiologie e
JOIN epr_suivi s ON s.pseudonyme = e.pseudonyme
WHERE e.etiologie_principale = TRUE;


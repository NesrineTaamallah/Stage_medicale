

-- Table pivot commune aux deux registres (alimentée par la fenêtre 3)
CREATE TABLE IF NOT EXISTS patients (
    pseudonyme          VARCHAR(255) PRIMARY KEY,   -- sortie de la fonction de hashage
    registre             VARCHAR(10) NOT NULL CHECK (registre IN ('SEP', 'EPR')),
    date_inclusion        DATE,
    age                    NUMERIC,                  -- âge au moment de l'inclusion
    sexe                   VARCHAR(10),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- REGISTRE SEP (Sclérose En Plaques pédiatrique)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sep_identification_clinique (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    sexe                          VARCHAR(10),
    gouvernorat_code               VARCHAR(10),
    date_diagnostic                 DATE,
    age_diagnostic_mois              NUMERIC,
    age_premier_symptome_mois         NUMERIC,
    delai_diagnostic_mois              NUMERIC
);

CREATE TABLE IF NOT EXISTS sep_presentation_initiale (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    type_premier_evenement        VARCHAR(100),
    recuperation_complete           VARCHAR(10)   -- 'oui'/'non'/'NA' (littéral 'NA' = non applicable)
);

CREATE TABLE IF NOT EXISTS sep_evolution (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    forme_evolutive                VARCHAR(50),   -- ex: RR, SP ... ('NA' littéral possible)
    date_conversion_sp              DATE
);

CREATE TABLE IF NOT EXISTS sep_antecedents (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    consanguinite_parentale        BOOLEAN
);

CREATE TABLE IF NOT EXISTS sep_edss_visites (
    id                    SERIAL PRIMARY KEY,
    pseudonyme              VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_visite               DATE NOT NULL,
    score_edss                  NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_sep_edss_pseudo ON sep_edss_visites(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_irm (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen                    DATE NOT NULL,
    nb_lesions_t2                     INTEGER,
    prise_contraste_gd                  BOOLEAN,
    nouvelles_lesions_vs_irm_anterieure    BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_sep_irm_pseudo ON sep_irm(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_poussees (
    id                    SERIAL PRIMARY KEY,
    pseudonyme              VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_poussee               DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sep_poussees_pseudo ON sep_poussees(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_biologie_lcr (
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_prelevement               DATE,
    bandes_oligoclonales             BOOLEAN,
    index_igg                          NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_sep_lcr_pseudo ON sep_biologie_lcr(pseudonyme);

CREATE TABLE IF NOT EXISTS sep_suivi (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    date_dernier_suivi             DATE,
    statut_dernier_suivi             VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS sep_traitement_fond (
    id                     SERIAL PRIMARY KEY,
    pseudonyme               VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    molecule                    VARCHAR(100),
    ligne_therapeutique            INTEGER,
    date_debut                       DATE,
    date_fin                           DATE,
    date_fin_effective                   DATE,
    motif_switch                          VARCHAR(100),
    observance                              VARCHAR(20)
);
CREATE INDEX IF NOT EXISTS idx_sep_traitement_pseudo ON sep_traitement_fond(pseudonyme);

-- Table de référence utilisée par les analyses d'efficacité de traitement
CREATE TABLE IF NOT EXISTS reference_groupe_efficacite (
    molecule    VARCHAR(100) PRIMARY KEY,
    groupe        VARCHAR(50)
);

-- ============================================================================
-- REGISTRE EPR (Épilepsie Résistante pédiatrique)
-- ============================================================================

CREATE TABLE IF NOT EXISTS epr_identification_clinique (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    age_debut_crises_mois                  NUMERIC,
    age_diagnostic_pharmacoresistance_mois    NUMERIC
);

CREATE TABLE IF NOT EXISTS epr_pharmacoresistance (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    statut_pharmacoresistance_confirme    BOOLEAN
);

CREATE TABLE IF NOT EXISTS epr_suivi (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    duree_suivi_mois               NUMERIC,
    statut_dernier_suivi             VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS epr_etiologie (
    pseudonyme                  VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    etiologie_principale            VARCHAR(100),
    categorie_etiologique             VARCHAR(50)
);


CREATE TABLE IF NOT EXISTS epr_type_crise (
    id            SERIAL PRIMARY KEY,
    pseudonyme       VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    type_crise_ilae2017  VARCHAR(100),
    sous_type              VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS epr_frequence_crises (
    id                        SERIAL PRIMARY KEY,
    pseudonyme                  VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_rapport                   DATE,
    frequence_normalisee_mois        NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_epr_freq_pseudo ON epr_frequence_crises(pseudonyme);

CREATE TABLE IF NOT EXISTS epr_imagerie (
    id                            SERIAL PRIMARY KEY,
    pseudonyme                      VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen                        DATE,
    nb_lesions_t2                         INTEGER,
    nb_lesions_rehaussees                    INTEGER,
    prise_contraste_gd                          BOOLEAN,
    localisation_juxta_corticale                   BOOLEAN,
    localisation_moelle                              BOOLEAN
);

CREATE TABLE IF NOT EXISTS epr_eeg (
    id                SERIAL PRIMARY KEY,
    pseudonyme           VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    date_examen             DATE,
    resultat                   VARCHAR(50)   -- 'normal' / 'anormal' — à confirmer
);

CREATE TABLE IF NOT EXISTS epr_liste_ae (
    id            SERIAL PRIMARY KEY,
    pseudonyme       VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    nom_ae              VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS epr_antecedents (
    pseudonyme                          VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    atcd_perinataux                        BOOLEAN,
    atcd_familiaux_epilepsie                 BOOLEAN,
    developpement_psychomoteur_avant_crises    VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS epr_regression_developpementale (
    pseudonyme            VARCHAR(255) PRIMARY KEY REFERENCES patients(pseudonyme),
    presence_regression       BOOLEAN
);

CREATE TABLE IF NOT EXISTS epr_genetique (
    pseudonyme          VARCHAR(255) NOT NULL REFERENCES patients(pseudonyme),
    gene_teste              VARCHAR(100),
    classification_acmg        VARCHAR(50)
);

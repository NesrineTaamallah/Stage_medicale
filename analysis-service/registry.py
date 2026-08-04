"""
Registre des analyses. AUCUN des 13 scripts originaux n'est modifié :
chaque entrée décrit seulement (a) quelles constantes en tête de fichier
peuvent être pilotées depuis le formulaire React, et (b) l'ordre des
éventuelles réponses input() à fournir. L'exécution passe systématiquement
par script_runner.run_original_script() (voir ce fichier).
"""
import os
from script_runner import run_original_script

# Adapter ce chemin à l'emplacement réel du dossier sur le serveur
SCRIPTS_DIR = os.environ.get(
    "SCRIPTS_DIR",
    os.path.join(os.path.dirname(__file__), "..", "test_analyse_statistique"),
)

PG_ENV = {
    "PGHOST": os.environ.get("PGHOST", "localhost"),
    "PGPORT": os.environ.get("PGPORT", "5432"),
    "PGDATABASE": os.environ.get("PGDATABASE", "registre_neuroexo"),
    "PGUSER": os.environ.get("PGUSER", "postgres"),
    "PGPASSWORD": os.environ.get("PGPASSWORD", ""),
}


def _sep(nom_fichier):
    return os.path.join(SCRIPTS_DIR, "SEP", nom_fichier)


def _epr(nom_fichier):
    return os.path.join(SCRIPTS_DIR, "EPR", nom_fichier)


# ---------------------------------------------------------------------------
# SEP
# ---------------------------------------------------------------------------

def run_sep1(engine, config):
    # test1_sep.py : déjà refactoré en profondeur (voir sep/test1_delai_diagnostic_edss.py)
    from sep.test1_delai_diagnostic_edss import run as _run
    return _run(engine, config)


# Le schéma du formulaire est défini directement dans le script refactoré
# (PARAMETRES_SCHEMA), pour ne pas le dupliquer ici. Import isolé pour ne
# pas casser le registre si jamais ce fichier bouge.
from sep.test1_delai_diagnostic_edss import PARAMETRES_SCHEMA as SEP1_PARAMETRES_SCHEMA


def run_sep2(engine, config):
    # test2_sep.py : déjà refactoré (voir sep/test2_recuperation_edss.py), en
    # suivant le même pattern que test1 et test3 -- requêtes Postgres directes
    # au lieu du CSV local du script original, l'exclusion post-poussée étant
    # recalculée depuis sep_poussees plutôt que dépendre d'une colonne
    # date_derniere_poussee pré-jointe.
    from sep.test2_recuperation_edss import run as _run
    return _run(engine, config)


from sep.test2_recuperation_edss import PARAMETRES_SCHEMA as SEP2_PARAMETRES_SCHEMA


def run_sep3(engine, config):
    # test3_sep.py : déjà refactoré en profondeur (voir sep/test3_tap_precoce.py),
    # exactement comme test1_sep.py -> sep/test1_delai_diagnostic_edss.py.
    # Le module refactoré retourne notes/figures/tableau/resume_stats en JSON
    # structuré (chiffres clés pour le dashboard), au lieu du texte brut
    # produit par l'ancien run_original_script() sur le script legacy.
    from sep.test3_tap_precoce import run as _run
    return _run(engine, config)


from sep.test3_tap_precoce import PARAMETRES_SCHEMA as SEP3_PARAMETRES_SCHEMA


def run_sep4(engine, config):
    # test4_sep.py : désormais branché comme sep_1/2/3, sur le module refactoré
    # sep/test4_charge_t2_severite.py (run(engine, config) -> notes/figures/
    # tableau/resume_stats en JSON structuré), au lieu du script CLI original
    # exécuté via run_original_script() + réponses stdin simulées.
    # [CORRECTIF] cette dernière voie n'était plus alignée avec le module déjà
    # refactoré (schéma de config incompatible : "cox"/"lineaire_simple"/
    # "lineaire_multiple" côté module vs indices "1"/"2"/"3" côté ancien
    # run_sep4) et contenait en plus le bug de biais de temps immortel corrigé
    # dans detecter_progression_confirmee (visites EDSS antérieures à
    # date_diagnostic non exclues -> temps_progression négatif possible).
    from sep.test4_charge_t2_severite import run as _run
    return _run(engine, config)


from sep.test4_charge_t2_severite import PARAMETRES_SCHEMA as SEP4_PARAMETRES_SCHEMA


def run_sep5(engine, config):
    # test5_sep.py : désormais branché comme sep_1/2/3/4, sur le module
    # refactoré sep/test5_lcr_survie_tap.py (run(engine, config) -> notes/
    # figures/tableau/resume_stats en JSON structuré), au lieu du script CLI
    # original exécuté via run_original_script() + substitution de CONFIG en
    # mémoire. Même logique statistique, aucun écart de schéma corrigé ici
    # (contrairement à test4) : les durées sont calculées côté pandas, pas en
    # SQL, donc pas de bug EXTRACT(EPOCH FROM date - date).
    from sep.test5_lcr_survie_tap import run as _run
    return _run(engine, config)


from sep.test5_lcr_survie_tap import PARAMETRES_SCHEMA as SEP5_PARAMETRES_SCHEMA


def run_sep6(engine, config):
    # test6_sep.py : le fichier expose déjà charger_donnees_db(connection),
    # définie mais non appelée par son __main__ (qui n'accepte qu'un CSV en
    # argument). On exécute le script tel quel ; la variante DB reste
    # disponible dans le fichier si vous décidez un jour de la relier vous-
    # même — je n'y touche pas.
    return run_original_script(_sep("test6_sep.py"), env_overrides=PG_ENV)


def run_sep8(engine, config):
    # test8_sep.py : entièrement piloté par variables d'environnement (déjà
    # prévu dans le script : PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD)
    return run_original_script(_sep("test8_sep.py"), env_overrides=PG_ENV)


# ---------------------------------------------------------------------------
# EPR
# ---------------------------------------------------------------------------

def _db_uri():
    return (f"postgresql+psycopg2://{PG_ENV['PGUSER']}:{PG_ENV['PGPASSWORD']}"
            f"@{PG_ENV['PGHOST']}:{PG_ENV['PGPORT']}/{PG_ENV['PGDATABASE']}")


def run_epr1(engine, config):
    overrides = {
        "DB_URI": _db_uri(),
        "ANALYSIS_MODE": config.get("mode_analyse", "univariate"),
        "AGE_VARIABLE_MODE": config.get("mode_age", "categorical"),
        "SELECTED_COVARIATES": config.get("covariables", []),
    }
    return run_original_script(_epr("test1_epr.py"), overrides=overrides)


def run_epr2(engine, config):
    return run_original_script(_epr("test2_epr.py"), env_overrides=PG_ENV)


def run_epr3(engine, config):
    return run_original_script(_epr("test3_epr.py"), env_overrides=PG_ENV)


def run_epr4(engine, config):
    return run_original_script(_epr("test4_epr.py"), overrides={"DB_URI": _db_uri()})


def run_epr5(engine, config):
    return run_original_script(_epr("test5_epr.py"), overrides={"DB_URI": _db_uri()})


# ---------------------------------------------------------------------------
# Registre exposé à l'API — alimente automatiquement le frontend
# ---------------------------------------------------------------------------

ANALYSES = {
    "sep_1": {"registre": "SEP", "titre": "Délai diagnostique et pronostic (EDSS)",
              "description": "Régression linéaire/logistique délai → EDSS.",
              "parametres_schema": SEP1_PARAMETRES_SCHEMA, "run": run_sep1},
    "sep_2": {"registre": "SEP", "titre": "Récupération incomplète (1er épisode) et trajectoire EDSS",
              "description": "Modèle mixte longitudinal EDSS(t), transformation du temps choisie par AIC.",
              "parametres_schema": SEP2_PARAMETRES_SCHEMA, "run": run_sep2},
    "sep_3": {"registre": "SEP", "titre": "Taux annualisé de poussées (TAP) précoce",
              "description": "TAP précoce, modèle Poisson/Binomiale Négative.",
              "parametres_schema": SEP3_PARAMETRES_SCHEMA, "run": run_sep3},
    "sep_4": {"registre": "SEP", "titre": "Charge lésionnelle T2 et sévérité future",
              "description": "Cox / régression linéaire simple ou multiple, EDSS à 2 ou 5 ans.",
              "parametres_schema": SEP4_PARAMETRES_SCHEMA, "run": run_sep4},
    "sep_5": {"registre": "SEP", "titre": "LCR (bandes oligoclonales/IgG) et évolution",
              "description": "Modèle de comptage + Cox, horizons paramétrables.",
              "parametres_schema": SEP5_PARAMETRES_SCHEMA, "run": run_sep5},
    "sep_6": {"registre": "SEP", "titre": "Consanguinité, sexe et forme évolutive",
              "description": "Tests chi²/Fisher sur antécédents et présentation clinique.",
              "parametres_schema": {}, "run": run_sep6},
    "sep_8": {"registre": "SEP", "titre": "Prédiction de sévérité (modèle validé, VIF, bootstrap)",
              "description": "Modèle de sévérité SEP avec validation croisée et calibration.",
              "parametres_schema": {}, "run": run_sep8},

    "epr_1": {"registre": "EPR", "titre": "Étiologie/pharmacorésistance — survie",
              "description": "Kaplan-Meier / Cox, univarié ou multivarié.",
              "parametres_schema": {
                  "mode_analyse": {"type": "select", "options": ["univariate", "multivariate"], "label": "Mode"},
                  "covariables": {"type": "multiselect", "options": [
                      "etiologie_structurelle", "crises_types_multiples", "freq_crises_baseline_mois",
                      "irm_anormale", "eeg_anormal", "atcd_perinataux",
                      "developpement_psychomoteur_avant_crises", "presence_regression",
                  ], "label": "Covariables"},
              }, "run": run_epr1},
    "epr_2": {"registre": "EPR", "titre": "Étiologie et pharmacorésistance (régression)",
              "description": "Régression logistique étiologie -> pharmacorésistance.",
              "parametres_schema": {}, "run": run_epr2},
    "epr_3": {"registre": "EPR", "titre": "Type de crise ILAE 2017 et nombre d'AE essayés",
              "description": "ANOVA / comparaisons post-hoc (Tukey HSD).",
              "parametres_schema": {}, "run": run_epr3},
    "epr_4": {"registre": "EPR", "titre": "Analyse EPR #4",
              "description": "Voir docstring du script original pour le détail clinique.",
              "parametres_schema": {}, "run": run_epr4},
    "epr_5": {"registre": "EPR", "titre": "Analyse EPR #5",
              "description": "Voir docstring du script original pour le détail clinique.",
              "parametres_schema": {}, "run": run_epr5},

    # sep_2 et sep_7 : NON branchés, voir NOTE ci-dessous.
}

# -----------------------------------------------------------------------
# NOTE — 1 test volontairement non branché, à trancher avec l'équipe :
#
# sep_7 (test7_sep.py) : n'est pas un test statistique paramétrable —
# c'est un outil de classement interactif molécule par molécule
# (le clinicien répond pour CHAQUE molécule non classée, nombre de
# questions variable). Ça mérite son propre écran ("Classer les
# molécules") avec sauvegarde au fur et à mesure, pas le formulaire
# générique config->run->résultats des 11 autres tests.
# -----------------------------------------------------------------------
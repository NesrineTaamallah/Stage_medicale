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
    os.path.join(os.path.dirname(__file__), "..", "..", "test_analyse_statistique"),
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


def run_sep3(engine, config):
    # test3_sep.py : TAP précoce — 4 questions input() dans cet ordre :
    #   1) fenêtre TAP (années, ou vide = défaut)
    #   2) "2" pour ajuster sur covariables, sinon vide
    #   3) indices covariables séparés par virgules (si étape 2 = "2")
    #   4) "1" ou "2" pour choisir Poisson / Binomiale Négative
    reponses = [
        str(config.get("fenetre_tap_annees", "")),
        "2" if config.get("covariables") else "",
        ",".join(str(i) for i in config.get("covariables_indices", [])),
        "1" if config.get("modele_tap", "poisson") == "poisson" else "2",
    ]
    return run_original_script(_sep("test3_sep.py"), reponses_stdin=reponses, env_overrides=PG_ENV)


def run_sep4(engine, config):
    # test4_sep.py : horizon (2 ou 5), type régression (1/2/3), covariables si 1 ou 3
    reponses = [str(config.get("horizon", 2)), str(config.get("type_regression", 2))]
    if str(config.get("type_regression")) in ("1", "3"):
        reponses.append(",".join(config.get("covariables", [])))
    return run_original_script(_sep("test4_sep.py"), reponses_stdin=reponses, env_overrides=PG_ENV)


def run_sep5(engine, config):
    # test5_sep.py : entièrement piloté par la constante CONFIG (aucun input())
    overrides = {"CONFIG": {
        "count_model": config.get("count_model", "auto"),
        "horizons_years": config.get("horizons_years", [1, 2, 5]),
        "igg_threshold": config.get("igg_threshold", 0.7),
        "multiple_testing_correction": config.get("multiple_testing_correction", "bonferroni"),
    }}
    env = {**PG_ENV, "SEP_DB_HOST": PG_ENV["PGHOST"], "SEP_DB_PORT": PG_ENV["PGPORT"],
           "SEP_DB_NAME": PG_ENV["PGDATABASE"], "SEP_DB_USER": PG_ENV["PGUSER"],
           "SEP_DB_PASSWORD": PG_ENV["PGPASSWORD"]}
    return run_original_script(_sep("test5_sep.py"), overrides=overrides, env_overrides=env)


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
              "parametres_schema": {}, "run": run_sep1},
    "sep_3": {"registre": "SEP", "titre": "Taux annualisé de poussées (TAP) précoce",
              "description": "TAP précoce, modèle Poisson/Binomiale Négative.",
              "parametres_schema": {
                  "fenetre_tap_annees": {"type": "number", "label": "Fenêtre TAP (années)"},
                  "covariables_indices": {"type": "text", "label": "Indices covariables (ex: 0,1)"},
                  "modele_tap": {"type": "select", "options": ["poisson", "nb"], "label": "Modèle"},
              }, "run": run_sep3},
    "sep_4": {"registre": "SEP", "titre": "Charge lésionnelle T2 et sévérité future",
              "description": "Cox / régression linéaire simple ou multiple, EDSS à 2 ou 5 ans.",
              "parametres_schema": {
                  "horizon": {"type": "select", "options": [2, 5], "label": "Horizon EDSS (ans)"},
                  "type_regression": {"type": "select", "options": [1, 2, 3],
                                       "label": "1=Cox, 2=Linéaire simple, 3=Linéaire multiple"},
                  "covariables": {"type": "text", "label": "Covariables (séparées par virgules)"},
              }, "run": run_sep4},
    "sep_5": {"registre": "SEP", "titre": "LCR (bandes oligoclonales/IgG) et évolution",
              "description": "Modèle de comptage + Cox, horizons paramétrables.",
              "parametres_schema": {
                  "horizons_years": {"type": "text", "label": "Horizons (ex: 1,2,5)"},
                  "igg_threshold": {"type": "number", "default": 0.7, "label": "Seuil index IgG"},
              }, "run": run_sep5},
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
# NOTE — 2 tests volontairement non branchés, à trancher avec l'équipe :
#
# sep_2 (test2_sep.py) : ne lit QUE depuis un fichier CSV local
# (charger_donnees(chemin_csv), pas de requête Postgres dans ce script).
# Pour le brancher il faut soit :
#   (a) ajouter un import CSV côté fenêtre 3, soit
#   (b) faire écrire un export CSV du dataset patient avant de lancer ce
#       test — décision produit, pas une question technique.
#
# sep_7 (test7_sep.py) : n'est pas un test statistique paramétrable —
# c'est un outil de classement interactif molécule par molécule
# (le clinicien répond pour CHAQUE molécule non classée, nombre de
# questions variable). Ça mérite son propre écran ("Classer les
# molécules") avec sauvegarde au fur et à mesure, pas le formulaire
# générique config->run->résultats des 11 autres tests.
# -----------------------------------------------------------------------

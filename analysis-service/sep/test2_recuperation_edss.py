"""
Refactor de test_analyse_statistique/SEP/test2_sep.py (récupération
incomplète au 1er épisode et trajectoire EDSS) en fonction appelable
par l'API, sans lecture CSV ni plt.show().

Différence structurelle avec le script original : celui-ci lisait un
CSV externe (registre_sep_pediatrique.csv) avec une colonne
`date_derniere_poussee` déjà précalculée par ligne. Ici, comme pour
test3_tap_precoce.py, on reconstruit les mêmes informations directement
depuis PostgreSQL (sep_identification_clinique, sep_presentation_initiale,
sep_edss_visites, sep_poussees) : la table sep_poussees liste toutes les
poussées par patient, donc l'exclusion post-poussée est recalculée pour
chaque visite au lieu de dépendre d'une colonne pré-jointe.

La logique statistique (agrégation trimestrielle, choix de la
transformation du temps par AIC, modèle mixte REML/ML avec repli
intercept seul, diagnostics RMSE/PWPE/POPE, effet à horizon avec IC95%,
analyse de sensibilité ordinale) est STRICTEMENT IDENTIQUE au script
original.

Variables d'ajustement disponibles : seules `age_diagnostic` et `sexe`
sont branchées ici, car `severite_poussee` et `traitement_dmt` (proportion
du suivi sous DMT) ne correspondent à AUCUNE colonne du schéma PostgreSQL
actuel (backend/config/schema_registre.sql) — contrairement au CSV du
script original qui les avait en dur. Les ajouter nécessiterait d'abord
d'étendre le schéma (ex: sep_traitement_fond pour dériver une proportion
de suivi sous traitement actif), donc décision produit à trancher avec
l'encadrante, pas une adaptation technique silencieuse.
"""
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats
from sqlalchemy import text
import matplotlib.pyplot as plt

from common import figure_to_base64, Notes

FENETRE_POST_POUSSEE_DEFAUT_MOIS = 3
MIN_POINTS_ALERTE = 30
MIN_PATIENTS_ALERTE = 15
MIN_VISITS_FOR_RANDOM_SLOPE = 3
EPSILON_TIME = 1e-3
HORIZONS_CLINIQUES_DEFAUT = (2, 5, 10)

VARIABLES_SUPPLEMENTAIRES_AUTORISEES = {
    "age_diagnostic": {
        "colonne_attendue": "age_diagnostic_annees",
        "source": "Sotiropoulos et al. 2021 ; modèle multilevel Uzochukwu et al. "
                   "2023/2024 : covariable de base ajustée.",
    },
    "sexe": {
        "colonne_attendue": "sexe",
        "source": "Sotiropoulos et al. 2021 ; Uzochukwu et al. 2023/2024 : "
                   "covariable de base ajustée.",
    },
}

# Décrit le formulaire attendu côté React (voir AnalyseStatistiqueTab.jsx)
PARAMETRES_SCHEMA = {
    "fenetre_post_poussee_mois": {"type": "select", "options": [1, 3, 6], "allow_custom": True,
                                   "default": FENETRE_POST_POUSSEE_DEFAUT_MOIS,
                                   "label": "Fenêtre d'exclusion post-poussée (mois)"},
    "variables_supplementaires": {"type": "multiselect",
                                   "options": list(VARIABLES_SUPPLEMENTAIRES_AUTORISEES.keys()),
                                   "label": "Covariables d'ajustement (optionnel)"},
    "inclure_analyse_ordinale": {"type": "boolean", "default": False,
                                  "label": "Inclure l'analyse de sensibilité ordinale (contrôle de direction)"},
}


def charger_onset_et_recuperation(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT
            ic.pseudonyme AS patient_id,
            (ic.date_diagnostic - (ic.delai_diagnostic_mois || ' months')::interval)::date
                AS date_onset,
            (ic.age_diagnostic_mois / 12.0) AS age_diagnostic_annees,
            ic.sexe,
            pi.recuperation_complete
        FROM sep_identification_clinique ic
        JOIN patients p ON p.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_presentation_initiale pi ON pi.pseudonyme = ic.pseudonyme
        WHERE p.registre = 'SEP'
          AND ic.date_diagnostic IS NOT NULL
          AND ic.delai_diagnostic_mois IS NOT NULL
    """)
    df = pd.read_sql(requete, engine)
    df["date_onset"] = pd.to_datetime(df["date_onset"])

    n_avant = len(df)
    n_na_litteral = (df["recuperation_complete"] == "NA").sum()
    if n_na_litteral:
        notes(f"ℹ️ {n_na_litteral} valeur(s) 'NA' (non applicable) détectée(s) dans "
              "recuperation_complete → traitées comme manquantes, pas comme modalité.")
    df.loc[df["recuperation_complete"] == "NA", "recuperation_complete"] = np.nan

    n_sans_recup = df["recuperation_complete"].isna().sum()
    if n_sans_recup:
        notes(f"⚠️ {n_sans_recup}/{n_avant} patient(s) sans recuperation_complete "
              "renseignée — exclus de l'analyse (variable d'intérêt).")
    df = df.dropna(subset=["recuperation_complete"]).copy()
    df["recuperation_incomplete"] = (df["recuperation_complete"].str.lower().str.strip() == "non").astype(int)

    notes("\n  [A CONFIRMER AVEC L'ENCADRANTE] La colonne 'recuperation_complete' "
          "('oui'/'non') est utilisée telle quelle. Sotiropoulos et al. définissent "
          "précisément la récupération incomplète comme un retour incomplet de "
          "l'EDSS ET du score fonctionnel (FSS) à la baseline PRE-poussée, évalué "
          "à 6 mois post-poussée. Le registre ne capture pas le FSS séparément : "
          "si le codage de l'encadrante diffère de cette définition, le signaler "
          "explicitement — les résultats ne seront alors pas strictement "
          "comparables aux références citées.")
    return df


def charger_edss(engine, onset: pd.DataFrame, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT pseudonyme AS patient_id, date_visite, score_edss
        FROM sep_edss_visites
        WHERE date_visite IS NOT NULL AND score_edss IS NOT NULL
        ORDER BY pseudonyme, date_visite
    """)
    df = pd.read_sql(requete, engine, parse_dates=["date_visite"])

    n_avant = df["patient_id"].nunique()
    df = df.merge(onset[["patient_id", "date_onset", "recuperation_incomplete"]],
                   on="patient_id", how="inner")
    n_apres = df["patient_id"].nunique()
    if n_apres < n_avant:
        notes(f"ℹ️ {n_avant - n_apres} patient(s) avec des visites EDSS mais sans "
              "date_onset/recuperation_complete exploitable — exclus.")

    df["temps_annees"] = (df["date_visite"] - df["date_onset"]).dt.days / 365.25
    n_neg = (df["temps_annees"] < 0).sum()
    if n_neg:
        notes(f"[ATTENTION] {n_neg} visites avec date_visite < date_onset retirées "
              "(vérifier la saisie).")
        df = df[df["temps_annees"] >= 0]
    df["temps_annees_pos"] = df["temps_annees"] + EPSILON_TIME
    return df


def charger_poussees(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT pseudonyme AS patient_id, date_poussee
        FROM sep_poussees WHERE date_poussee IS NOT NULL
        ORDER BY pseudonyme, date_poussee
    """)
    df = pd.read_sql(requete, engine, parse_dates=["date_poussee"])
    return df


def exclure_edss_post_poussee(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                               fenetre_mois: float, notes: Notes) -> pd.DataFrame:
    df = df_edss.copy()
    a_exclure = pd.Series(False, index=df.index)

    for pid, groupe_poussees in df_poussees.groupby("patient_id"):
        indices_patient = df.index[df["patient_id"] == pid]
        if len(indices_patient) == 0:
            continue
        for date_p in groupe_poussees["date_poussee"]:
            delai_jours = (df.loc[indices_patient, "date_visite"] - date_p).dt.days
            proche = (delai_jours >= 0) & (delai_jours < fenetre_mois * 30.44)
            a_exclure.loc[indices_patient[proche.values]] = True

    n_exclus = a_exclure.sum()
    notes(f"  Fenêtre {fenetre_mois:g} mois post-poussée : {n_exclus} mesures EDSS "
          f"exclues sur {len(df)} (proximité avec une poussée, toutes poussées confondues).")
    return df[~a_exclure].copy()


def agreger_par_trimestre(df: pd.DataFrame, colonnes_supp: list, notes: Notes) -> pd.DataFrame:
    df = df.copy()
    df["trimestre"] = (df["temps_annees"] * 4).round().astype(int)

    agg_dict = {
        "score_edss": ("score_edss", "median"),
        "temps_annees": ("temps_annees", "median"),
        "temps_annees_pos": ("temps_annees_pos", "median"),
        "recuperation_incomplete": ("recuperation_incomplete", "first"),
    }
    for col in colonnes_supp:
        agg_dict[col] = (col, "first")

    agg = df.groupby(["patient_id", "trimestre"], as_index=False).agg(**agg_dict)
    notes(f"  Agrégation trimestrielle : {len(df)} visites → {len(agg)} points EDSS "
          "(médiane par trimestre/patient).")
    return agg


def valider_variables_supplementaires(variables_supplementaires, df, notes: Notes) -> list:
    if not variables_supplementaires:
        return []
    noms_colonnes = []
    for v in variables_supplementaires:
        if v not in VARIABLES_SUPPLEMENTAIRES_AUTORISEES:
            raise ValueError(
                f"Variable '{v}' non autorisée : aucune référence bibliographique "
                f"associée. Variables disponibles : "
                f"{list(VARIABLES_SUPPLEMENTAIRES_AUTORISEES)}."
            )
        col = VARIABLES_SUPPLEMENTAIRES_AUTORISEES[v]["colonne_attendue"]
        if col not in df.columns or df[col].isna().all():
            raise ValueError(
                f"Variable '{v}' demandée mais colonne '{col}' absente ou entièrement "
                "manquante dans les données chargées."
            )
        noms_colonnes.append(col)
    return noms_colonnes


def preparer_donnees(engine, fenetre_mois: float, variables_supplementaires: list, notes: Notes) -> pd.DataFrame:
    onset = charger_onset_et_recuperation(engine, notes)
    df = charger_edss(engine, onset, notes)
    df_poussees = charger_poussees(engine, notes)

    colonnes_supp = valider_variables_supplementaires(variables_supplementaires, onset, notes)
    if colonnes_supp:
        df = df.merge(onset[["patient_id"] + colonnes_supp], on="patient_id", how="left")

    notes(f"\n--- Exclusion post-poussée (fenêtre = {fenetre_mois:g} mois) ---")
    df = exclure_edss_post_poussee(df, df_poussees, fenetre_mois, notes)

    notes("\n--- Agrégation trimestrielle (réduction autocorrélation) ---")
    df = agreger_par_trimestre(df, colonnes_supp, notes)

    n_visites = df.groupby("patient_id").size()
    patients_valides = n_visites[n_visites >= 2].index
    n_retires = df["patient_id"].nunique() - len(patients_valides)
    if n_retires:
        notes(f"  {n_retires} patient(s) avec <2 mesures EDSS retiré(s) (pas de "
              "trajectoire estimable).")
    df = df[df["patient_id"].isin(patients_valides)].copy()

    n_patients_final = df["patient_id"].nunique()
    n_points_final = len(df)
    duree_suivi_mediane = (
        df.groupby("patient_id")["temps_annees"].max().median() if n_patients_final > 0 else np.nan
    )
    notes(f"\nDonnées finales : {n_patients_final} patients, {n_points_final} points EDSS.")
    if not np.isnan(duree_suivi_mediane):
        notes(f"Durée de suivi médiane par patient : {duree_suivi_mediane:.1f} ans.")

    if n_patients_final < MIN_PATIENTS_ALERTE or n_points_final < MIN_POINTS_ALERTE:
        notes(f"  [ALERTE EFFECTIF] {n_patients_final} patients / {n_points_final} points "
              f"restants après exclusions — effectif limité pour un modèle mixte "
              f"(seuils indicatifs {MIN_PATIENTS_ALERTE}/{MIN_POINTS_ALERTE}). Résultats "
              "à présenter avec cette réserve explicite.")

    if not np.isnan(duree_suivi_mediane) and duree_suivi_mediane < 5:
        notes(f"\n  [ALERTE SPÉCIFIQUE PÉDIATRIE] Suivi médian de {duree_suivi_mediane:.1f} ans, "
              "inférieur aux ~8,5 ans utilisés par Sotiropoulos et al. pour estimer un effet "
              "à 10 ans. La littérature pédiatrique montre une progression de l'EDSS "
              "nettement plus lente et tardive que chez l'adulte (cohorte Ped-MSSS, n=873 : "
              "52%/19,4%/1,5% atteignent un EDSS de 2/3/6). Un résultat non significatif ici "
              "doit être interprété comme 'non conclusif avec ce suivi', pas comme 'absence d'effet'.")
    return df


def obtenir_colonnes_temps(df: pd.DataFrame, transformation_temps: str) -> list:
    if transformation_temps == "lineaire":
        df["temps_f"] = df["temps_annees"]
        return ["temps_f"]
    elif transformation_temps == "racine":
        df["temps_f"] = np.sqrt(df["temps_annees_pos"])
        return ["temps_f"]
    elif transformation_temps == "log":
        df["temps_f"] = np.log(df["temps_annees_pos"])
        return ["temps_f"]
    elif transformation_temps == "combinee":
        df["temps_f_racine"] = np.sqrt(df["temps_annees_pos"])
        df["temps_f_log"] = np.log(df["temps_annees_pos"])
        return ["temps_f_racine", "temps_f_log"]
    raise ValueError("transformation_temps invalide")


def ajuster_modele_mixte(df: pd.DataFrame, transformation_temps: str, reml: bool,
                          colonnes_supp: list, notes: Notes):
    df = df.copy()
    colonnes_temps = obtenir_colonnes_temps(df, transformation_temps)
    termes_interaction = " + ".join(f"recuperation_incomplete * {c}" for c in colonnes_temps)
    formule = f"score_edss ~ {termes_interaction}"
    for col in colonnes_supp:
        formule += f" + {col}"
    re_formula_pente = "~" + "+".join(colonnes_temps)

    visites_par_patient = df.groupby("patient_id").size()
    part_suffisante = (visites_par_patient >= MIN_VISITS_FOR_RANDOM_SLOPE).mean()

    def _fit(re_formula_locale, reml_local):
        modele = smf.mixedlm(formule, data=df, groups=df["patient_id"], re_formula=re_formula_locale)
        try:
            res = modele.fit(reml=reml_local, method="lbfgs")
            if reml_local and not res.converged:
                raise np.linalg.LinAlgError("REML non convergé")
            return res, reml_local
        except Exception as e:
            if reml_local:
                notes(f"  [REPLI REML→ML] Échec REML ({e}) — bascule ML. Les estimations "
                      "de variance seront légèrement biaisées.")
                return modele.fit(reml=False, method="lbfgs"), False
            raise

    resultat, type_modele, reml_effectif = None, None, reml
    if part_suffisante >= 0.5:
        try:
            resultat, reml_effectif = _fit(re_formula_pente, reml)
            type_modele = "intercept + pente aléatoires" if resultat.converged else None
            if not resultat.converged:
                resultat = None
        except Exception as e:
            notes(f"  [Pente aléatoire] échec : {e}")
            resultat = None

    if resultat is None:
        notes("  → Repli sur INTERCEPT ALÉATOIRE SEUL (effectif insuffisant pour pente aléatoire fiable).")
        resultat, reml_effectif = _fit(None, reml)
        type_modele = "intercept aléatoire seul"

    if reml_effectif != reml:
        type_modele += " [REML→ML]"
    return resultat, type_modele, df


def choisir_meilleure_transformation_temps(df: pd.DataFrame, colonnes_supp: list, notes: Notes) -> pd.DataFrame:
    lignes = []
    for transfo in ["lineaire", "racine", "log", "combinee"]:
        try:
            resultat, type_modele, _ = ajuster_modele_mixte(df, transfo, reml=False,
                                                              colonnes_supp=colonnes_supp, notes=notes)
            lignes.append({"transformation": transfo, "type_modele": type_modele,
                            "aic": resultat.aic, "log_vraisemblance": resultat.llf,
                            "converged": resultat.converged})
        except Exception as e:
            lignes.append({"transformation": transfo, "type_modele": "échec",
                            "aic": np.nan, "log_vraisemblance": np.nan, "converged": False})
            notes(f"[ÉCHEC] transformation={transfo} : {e}")

    tableau = pd.DataFrame(lignes).sort_values("aic")
    notes("\n--- Comparaison des transformations du temps (AIC croissant) ---")
    notes(tableau.to_string(index=False))
    return tableau


def calculer_diagnostics(resultat, df: pd.DataFrame, notes: Notes) -> dict:
    predictions = resultat.fittedvalues
    residus = df["score_edss"].values - predictions.values
    rmse = float(np.sqrt(np.mean(residus ** 2)))
    pwpe = float(np.mean(np.abs(residus) <= 0.5) * 100)
    pope = float(np.mean(np.abs(residus) > 2.0) * 100)
    notes(f"📋 Diagnostics du modèle : RMSE={rmse:.3f} pts EDSS, {pwpe:.1f}% des "
          f"prédictions à ±0.5 pt, {pope:.1f}% à plus de ±2 pts.")
    return {"RMSE": rmse, "PWPE_pct": pwpe, "POPE_pct": pope}


def graphique_heteroscedasticite(resultat, df: pd.DataFrame):
    residus = df["score_edss"].values - resultat.fittedvalues.values
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    axes[0].scatter(df["score_edss"], residus, alpha=0.4, s=15)
    axes[0].axhline(0, color="black", linewidth=0.8)
    axes[0].set_xlabel("EDSS observé"); axes[0].set_ylabel("Résidu (observé - prédit)")
    axes[0].set_title("Variance résiduelle vs EDSS")

    axes[1].scatter(df["temps_annees"], residus, alpha=0.4, s=15, color="darkorange")
    axes[1].axhline(0, color="black", linewidth=0.8)
    axes[1].set_xlabel("Temps depuis l'onset (années)"); axes[1].set_ylabel("Résidu (observé - prédit)")
    axes[1].set_title("Variance résiduelle vs TEMPS (= CLOV)")

    plt.tight_layout()
    return fig


def effet_a_horizon(resultat, t: float, transformation_temps: str) -> tuple:
    if transformation_temps == "lineaire":
        t_f_par_terme = {"temps_f": t}
    elif transformation_temps == "racine":
        t_f_par_terme = {"temps_f": np.sqrt(t + EPSILON_TIME)}
    elif transformation_temps == "log":
        t_f_par_terme = {"temps_f": np.log(t + EPSILON_TIME)}
    elif transformation_temps == "combinee":
        t_f_par_terme = {"temps_f_racine": np.sqrt(t + EPSILON_TIME), "temps_f_log": np.log(t + EPSILON_TIME)}
    else:
        raise ValueError("transformation_temps invalide")

    params = resultat.params
    cov = resultat.cov_params()
    noms = list(params.index)
    L = np.zeros(len(noms))
    L[noms.index("recuperation_incomplete")] = 1.0
    for col_temps, val in t_f_par_terme.items():
        nom_int = f"recuperation_incomplete:{col_temps}"
        if nom_int in noms:
            L[noms.index(nom_int)] = val

    effet = float(L @ params.values)
    se = np.sqrt(max(float(L @ cov.values @ L.T), 0))
    ic_inf, ic_sup = effet - 1.96 * se, effet + 1.96 * se
    z = effet / se if se > 0 else np.nan
    p = 2 * (1 - stats.norm.cdf(abs(z))) if not np.isnan(z) else np.nan
    return effet, se, ic_inf, ic_sup, p


def interpreter_effet_clinique(resultat, transformation_temps: str, horizons_annees,
                                suivi_max_observe: float, notes: Notes) -> pd.DataFrame:
    horizons_extrapoles = [t for t in horizons_annees if t > suivi_max_observe]
    if horizons_extrapoles:
        notes(f"⚠️ Horizon(s) {horizons_extrapoles} an(s) au-delà du suivi maximal observé "
              f"({suivi_max_observe:.1f} ans) — IC95% à interpréter avec une prudence extrême.")

    lignes = []
    for t in (0,) + tuple(horizons_annees):
        effet, se, ic_inf, ic_sup, p = effet_a_horizon(resultat, t, transformation_temps)
        lignes.append({
            "horizon_annees": t, "effet_edss": round(effet, 3), "erreur_standard": round(se, 3),
            "IC95_inf": round(ic_inf, 3), "IC95_sup": round(ic_sup, 3),
            "p_value": round(p, 4) if not np.isnan(p) else None,
            "significatif_5pct": bool(p < 0.05) if not np.isnan(p) else None,
            "extrapolation_hors_suivi": (t in horizons_extrapoles),
        })
    tableau = pd.DataFrame(lignes)

    derniere = tableau.iloc[-1]
    sig_txt = ("statistiquement significatif" if derniere["significatif_5pct"]
               else "non significatif avec cet effectif — à interpréter avec prudence")
    notes(f"➡️ À {int(derniere['horizon_annees'])} ans de suivi, un enfant avec récupération "
          f"incomplète au 1er épisode a un EDSS supérieur en moyenne de "
          f"{derniere['effet_edss']:.2f} point(s) [IC95% {derniere['IC95_inf']:.2f} ; "
          f"{derniere['IC95_sup']:.2f}] par rapport à un enfant avec récupération complète "
          f"(p={derniere['p_value']:.3f}, {sig_txt}).")
    notes("[PRÉCISION MÉTHODOLOGIQUE] Cet effet est une différence de trajectoire issue d'un "
          "modèle mixte longitudinal (toutes les visites, effets aléatoires par patient), "
          "évaluée à un horizon donné — pas directement comparable au +0,6 point à 10 ans "
          "de Sotiropoulos et al. 2021 (régression simple, snapshot vs trajectoire complète).")
    return tableau


def tracer_trajectoires(df: pd.DataFrame, resultat, transformation_temps: str):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    couleurs = {0: "#2166ac", 1: "#b2182b"}
    labels = {0: "Récupération complète", 1: "Récupération incomplète"}

    ax = axes[0]
    for pid, groupe in df.groupby("patient_id"):
        groupe = groupe.sort_values("temps_annees")
        recup = groupe["recuperation_incomplete"].iloc[0]
        ax.plot(groupe["temps_annees"], groupe["score_edss"], color=couleurs[recup], alpha=0.25, linewidth=0.8)
    for recup, label in labels.items():
        ax.plot([], [], color=couleurs[recup], label=label)
    ax.set_xlabel("Temps depuis l'onset (années)"); ax.set_ylabel("EDSS")
    ax.set_title("Trajectoires individuelles"); ax.legend()

    ax = axes[1]
    t_range = np.linspace(0, df["temps_annees"].max(), 100)
    if transformation_temps == "lineaire":
        termes_temps = {"temps_f": t_range}
    elif transformation_temps == "racine":
        termes_temps = {"temps_f": np.sqrt(t_range + EPSILON_TIME)}
    elif transformation_temps == "log":
        termes_temps = {"temps_f": np.log(t_range + EPSILON_TIME)}
    else:
        termes_temps = {"temps_f_racine": np.sqrt(t_range + EPSILON_TIME), "temps_f_log": np.log(t_range + EPSILON_TIME)}

    params = resultat.params
    for recup, label in labels.items():
        edss_pred = params.get("Intercept", 0) + params.get("recuperation_incomplete", 0) * recup
        for col_temps, t_f in termes_temps.items():
            edss_pred = (edss_pred + params.get(col_temps, 0) * t_f
                         + params.get(f"recuperation_incomplete:{col_temps}", 0) * recup * t_f)
        ax.plot(t_range, edss_pred, color=couleurs[recup], linewidth=2.5, label=label)
    ax.set_xlabel("Temps depuis l'onset (années)"); ax.set_ylabel("EDSS prédit")
    ax.set_title("Trajectoire moyenne prédite"); ax.legend()

    plt.tight_layout()
    return fig


def analyse_sensibilite_ordinale(df: pd.DataFrame, notes: Notes) -> dict:
    try:
        from statsmodels.miscmodels.ordinal_model import OrderedModel
    except ImportError:
        notes("  [INDISPONIBLE] statsmodels.miscmodels.ordinal_model nécessite "
              "statsmodels >= 0.12. Analyse de sensibilité ordinale non exécutée.")
        return {}

    df_ord = df.copy()
    df_ord["edss_cat"] = pd.Categorical(df_ord["score_edss"], ordered=True)

    notes("  [LIMITE] Ce modèle ordinal traite chaque observation comme indépendante "
          "— il ignore que plusieurs mesures EDSS proviennent du même enfant. "
          "Résultat à interpréter comme un contrôle de cohérence de DIRECTION "
          "uniquement, pas comme une estimation d'effet fiable.")

    modele = OrderedModel(df_ord["edss_cat"], df_ord[["recuperation_incomplete", "temps_annees"]], distr="logit")
    resultat = modele.fit(method="bfgs", disp=False)

    coef_recup = float(resultat.params.get("recuperation_incomplete", np.nan))
    p_recup = float(resultat.pvalues.get("recuperation_incomplete", np.nan))
    notes(f"  Modèle ordinal naïf — effet 'recuperation_incomplete' : coef={coef_recup:.3f} "
          f"(odds ratio={np.exp(coef_recup):.2f}), p={p_recup:.4f}")
    notes(f"  Cohérence de direction avec le modèle mixte linéaire : "
          f"{'OUI' if coef_recup > 0 else 'NON — à investiguer'}.")
    return {"coef_recup_ordinal": round(coef_recup, 4), "p_value_ordinal": round(p_recup, 4)}


def run(engine, config: dict) -> dict:
    """Point d'entrée appelé par l'API. `config` = corps JSON envoyé par React."""
    notes = Notes()
    horizons_annees = tuple(config.get("horizons_annees", HORIZONS_CLINIQUES_DEFAUT))
    fenetre_mois = float(config.get("fenetre_post_poussee_mois") or FENETRE_POST_POUSSEE_DEFAUT_MOIS)
    variables_supplementaires = config.get("variables_supplementaires", [])

    notes(f"📋 Fenêtre d'exclusion post-poussée : {fenetre_mois:g} mois.")

    df = preparer_donnees(engine, fenetre_mois, variables_supplementaires, notes)
    if df.empty or df["patient_id"].nunique() < 2:
        raise ValueError(
            "Effectif insuffisant après nettoyage pour ajuster le modèle mixte EDSS(t) "
            "(moins de 2 patients avec au moins 2 mesures EDSS exploitables). "
            "Réduisez la fenêtre d'exclusion post-poussée ou retirez des covariables."
        )

    colonnes_supp = [VARIABLES_SUPPLEMENTAIRES_AUTORISEES[v]["colonne_attendue"]
                      for v in variables_supplementaires if v in VARIABLES_SUPPLEMENTAIRES_AUTORISEES]
    if variables_supplementaires:
        notes(f"\n  Modèle AJUSTÉ sur : {', '.join(variables_supplementaires)}")
    else:
        notes("\n  Modèle UNIVARIÉ (récupération seule).")

    tableau_transfos = choisir_meilleure_transformation_temps(df, colonnes_supp, notes)
    meilleure_transfo = tableau_transfos.iloc[0]["transformation"]
    notes(f"\n  → Transformation retenue (AIC minimal) : {meilleure_transfo}")

    resultat, type_modele, df_modele = ajuster_modele_mixte(
        df, meilleure_transfo, reml=True, colonnes_supp=colonnes_supp, notes=notes
    )
    notes(f"\n  Type de modèle retenu : {type_modele} (convergence={resultat.converged}).")

    diagnostics = calculer_diagnostics(resultat, df_modele, notes)
    fig_hetero = graphique_heteroscedasticite(resultat, df_modele)

    suivi_max = df_modele["temps_annees"].max()
    tableau_effets = interpreter_effet_clinique(
        resultat, meilleure_transfo, horizons_annees=horizons_annees,
        suivi_max_observe=suivi_max, notes=notes,
    )

    fig_traj = tracer_trajectoires(df_modele, resultat, meilleure_transfo)
    figures = [figure_to_base64(fig_hetero), figure_to_base64(fig_traj)]

    resultats_ordinal = {}
    if config.get("inclure_analyse_ordinale"):
        resultats_ordinal = analyse_sensibilite_ordinale(df_modele, notes)

    derniere = tableau_effets.iloc[-1]
    resume_stats = {
        "effet_edss": derniere["effet_edss"],
        "p_value": derniere["p_value"],
        "n_patients": int(df_modele["patient_id"].nunique()),
        "n_points": int(len(df_modele)),
        "type_modele": type_modele,
        "rmse": round(diagnostics["RMSE"], 3),
    }
    if resultats_ordinal:
        resume_stats["p_value_ordinal"] = resultats_ordinal["p_value_ordinal"]

    return {
        "notes": notes.lines,
        "figures": figures,
        "tableau": tableau_effets.to_dict(orient="records"),
        "resume_stats": resume_stats,
    }

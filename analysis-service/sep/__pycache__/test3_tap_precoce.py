"""
Refactor de test_analyse_statistique/SEP/test3_sep.py (TAP précoce et
évolution du handicap) en fonction appelable par l'API, sans input() ni
plt.show()/plt.savefig() vers un chemin fixe.

La logique statistique (requêtes SQL, calcul du TAP, GLM Poisson/Binomiale
Négative, modèle mixte EDSS(t), diagnostics) est STRICTEMENT IDENTIQUE au
script original — seule l'interface change :
  - les choix faits via input() viennent de `config` (formulaire React)
  - les print() vont dans `notes`
  - les figures sont encodées en base64 au lieu d'être sauvegardées sur disque
  - le tableau des effets cliniques et les chiffres clés sont retournés en
    JSON structuré au lieu d'être seulement imprimés
"""
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats
from sqlalchemy import text
import matplotlib.pyplot as plt

from common import figure_to_base64, Notes

FENETRES_TAP_LITTERATURE = {
    2.0: "2 premières années — fenêtre retenue par défaut.",
    1.0: "1 an — fenêtre courte, plus stricte (analyse de sensibilité).",
    5.0: "5 premières années — fenêtre alternative, suivi plus long.",
    3.0: "3 ans — option libre, à utiliser avec prudence.",
}
FENETRE_TAP_DEFAUT_ANNEES = 2.0
EXPOSITION_MIN_ANNEES = 0.5
FENETRE_POST_POUSSEE_DEFAUT_MOIS = 3
MIN_PATIENTS_ALERTE = 15
MIN_POINTS_ALERTE = 30
MIN_VISITS_FOR_RANDOM_SLOPE = 3
SEUIL_DISPERSION_ALERTE = 1.5
EPSILON_TIME = 1e-3
HORIZONS_CLINIQUES_DEFAUT = (2, 5, 10)

COVARIABLES_TAP_AUTORISEES = {
    "age_onset": {"colonne_attendue": "age_onset_annees", "source": "Âge au premier symptôme."},
    "sexe": {"colonne_attendue": "sexe", "source": "Sexe du patient."},
    "edss_inclusion": {"colonne_attendue": "edss_inclusion", "source": "EDSS à l'inclusion."},
}

# Décrit le formulaire attendu côté React (voir AnalyseStatistiqueTab.jsx)
PARAMETRES_SCHEMA = {
    "fenetre_tap_annees": {"type": "select", "options": [1, 2, 3, 5], "allow_custom": True,
                            "default": 2, "label": "Fenêtre TAP (années)"},
    "covariables": {"type": "multiselect", "options": list(COVARIABLES_TAP_AUTORISEES.keys()),
                     "label": "Covariables (ajustement du modèle TAP)"},
    "modele_tap": {"type": "select", "options": ["poisson", "nb"], "default": "poisson",
                    "label": "Modèle retenu pour valider la distribution du TAP"},
}


def charger_onset_patients(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT
            pseudonyme AS patient_id,
            (date_diagnostic - (delai_diagnostic_mois || ' months')::interval)::date
                AS date_onset,
            (age_premier_symptome_mois / 12.0) AS age_onset_annees,
            sexe
        FROM sep_identification_clinique
        WHERE date_diagnostic IS NOT NULL
          AND delai_diagnostic_mois IS NOT NULL
          AND age_premier_symptome_mois IS NOT NULL
    """)
    df = pd.read_sql(requete, engine)
    df["date_onset"] = pd.to_datetime(df["date_onset"])

    n_total_requete = pd.read_sql(
        text("SELECT COUNT(*) AS n FROM sep_identification_clinique"), engine
    )["n"].iloc[0]
    n_exclus = n_total_requete - len(df)
    if n_exclus > 0:
        notes(f"ℹ️ {n_exclus}/{n_total_requete} patient(s) exclu(s) de la reconstruction de "
              "date_onset : date_diagnostic, delai_diagnostic_mois ou "
              "age_premier_symptome_mois non renseigné(s).")
    return df


def charger_edss_inclusion(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT DISTINCT ON (v.pseudonyme)
            v.pseudonyme AS patient_id,
            v.score_edss AS edss_inclusion
        FROM sep_edss_visites v
        JOIN patients p ON p.pseudonyme = v.pseudonyme
        WHERE v.date_visite >= p.date_inclusion
          AND v.date_visite IS NOT NULL
          AND v.score_edss IS NOT NULL
          AND p.date_inclusion IS NOT NULL
        ORDER BY v.pseudonyme, v.date_visite ASC
    """)
    df = pd.read_sql(requete, engine)
    n_patients = pd.read_sql(text("SELECT COUNT(*) AS n FROM patients"), engine)["n"].iloc[0]
    n_sans_edss_inclusion = n_patients - len(df)
    if n_sans_edss_inclusion > 0:
        notes(f"ℹ️ {n_sans_edss_inclusion}/{n_patients} patient(s) sans edss_inclusion calculable "
              "(reste utilisable pour le TAP/EDSS(t), mais sans cette covariable si sélectionnée).")
    return df


def charger_covariables_patients(engine, notes: Notes) -> pd.DataFrame:
    onset = charger_onset_patients(engine, notes)
    edss_incl = charger_edss_inclusion(engine, notes)
    return onset.merge(edss_incl, on="patient_id", how="left")


def charger_edss(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT pseudonyme AS patient_id, date_visite, score_edss AS edss
        FROM sep_edss_visites
        WHERE date_visite IS NOT NULL AND score_edss IS NOT NULL
        ORDER BY pseudonyme, date_visite
    """)
    df = pd.read_sql(requete, engine, parse_dates=["date_visite"])
    n_visites_brutes = pd.read_sql(text("SELECT COUNT(*) AS n FROM sep_edss_visites"), engine)["n"].iloc[0]
    n_visites_exclues = n_visites_brutes - len(df)
    if n_visites_exclues > 0:
        notes(f"ℹ️ {n_visites_exclues}/{n_visites_brutes} ligne(s) de visites EDSS exclue(s) "
              "(date ou score manquant).")

    onset = charger_onset_patients(engine, notes)[["patient_id", "date_onset"]]
    n_avant_jointure = df["patient_id"].nunique()
    df = df.merge(onset, on="patient_id", how="inner")
    n_apres_jointure = df["patient_id"].nunique()
    if n_apres_jointure < n_avant_jointure:
        notes(f"ℹ️ {n_avant_jointure - n_apres_jointure} patient(s) sans date_onset "
              "reconstructible — exclus.")

    requis = {"patient_id", "date_onset", "date_visite", "edss"}
    manquantes = requis - set(df.columns)
    if manquantes:
        raise ValueError(f"Colonnes manquantes après chargement EDSS : {manquantes}")
    return df


def charger_poussees(engine, notes: Notes) -> pd.DataFrame:
    requete = text("""
        SELECT pseudonyme AS patient_id, date_poussee
        FROM sep_poussees WHERE date_poussee IS NOT NULL
        ORDER BY pseudonyme, date_poussee
    """)
    df = pd.read_sql(requete, engine, parse_dates=["date_poussee"])
    n_poussees_brutes = pd.read_sql(text("SELECT COUNT(*) AS n FROM sep_poussees"), engine)["n"].iloc[0]
    n_exclues = n_poussees_brutes - len(df)
    if n_exclues > 0:
        notes(f"ℹ️ {n_exclues}/{n_poussees_brutes} poussée(s) exclue(s) (date manquante).")

    requis = {"patient_id", "date_poussee"}
    manquantes = requis - set(df.columns)
    if manquantes:
        raise ValueError(f"Colonnes manquantes après chargement poussées : {manquantes}")
    return df


def resoudre_fenetre_tap(config: dict, notes: Notes) -> float:
    fenetre = float(config.get("fenetre_tap_annees") or FENETRE_TAP_DEFAUT_ANNEES)
    notes(f"📋 Fenêtre retenue pour le TAP précoce : {fenetre:.1f} an(s).")
    ref = FENETRES_TAP_LITTERATURE.get(fenetre)
    if ref:
        notes(f"   ({ref})")
    else:
        notes("   ⚠️ Fenêtre non standard (1, 2, 3 ou 5 ans) — analyse de sensibilité.")
    return fenetre


def calculer_tap_par_patient(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                              fenetre_annees: float, notes: Notes) -> pd.DataFrame:
    onset = df_edss.groupby("patient_id")["date_onset"].first()
    dernier_suivi = df_edss.groupby("patient_id")["date_visite"].max()

    lignes = []
    for pid, date_onset in onset.items():
        date_fin_fenetre = date_onset + pd.DateOffset(days=int(fenetre_annees * 365.25))
        date_fin_suivi_reelle = dernier_suivi.get(pid, date_onset)
        date_fin_observee = min(date_fin_fenetre, date_fin_suivi_reelle)
        exposition_annees = max((date_fin_observee - date_onset).days / 365.25, 0.0)

        poussees_patient = df_poussees[df_poussees["patient_id"] == pid]
        n_poussees = int((
            (poussees_patient["date_poussee"] >= date_onset)
            & (poussees_patient["date_poussee"] <= date_fin_observee)
        ).sum())

        lignes.append({
            "patient_id": pid, "date_onset": date_onset,
            "exposition_annees": exposition_annees, "n_poussees_fenetre": n_poussees,
            "censure_avant_fin_fenetre": date_fin_suivi_reelle < date_fin_fenetre,
        })

    tap = pd.DataFrame(lignes)
    n_avant = len(tap)
    tap_exclus = tap[tap["exposition_annees"] < EXPOSITION_MIN_ANNEES]
    tap = tap[tap["exposition_annees"] >= EXPOSITION_MIN_ANNEES].copy()
    if len(tap_exclus) > 0:
        notes(f"⚠️ {len(tap_exclus)} patient(s) exclu(s) du calcul du TAP : exposition < "
              f"{EXPOSITION_MIN_ANNEES} an (estimation non fiable sur un suivi trop court).")

    tap["tap_empirique"] = tap["n_poussees_fenetre"] / tap["exposition_annees"]
    n_censures = tap["censure_avant_fin_fenetre"].sum()
    notes(f"📋 TAP précoce calculé sur {len(tap)}/{n_avant} patients "
          f"(fenêtre = {fenetre_annees:.1f} an(s)).")
    if n_censures > 0:
        notes(f"ℹ️ {n_censures} patient(s) suivi(s) moins longtemps que la fenêtre choisie "
              "(exposition partielle, prise en compte via l'offset dans les modèles GLM).")
    return tap


def resoudre_covariables_tap(config: dict, df_tap: pd.DataFrame, notes: Notes) -> list:
    covariables_demandees = config.get("covariables", []) or []
    if not covariables_demandees:
        notes("📋 Aucune covariable — TAP moyen de population (intercept seul).")
        return []

    colonnes = []
    for nom in covariables_demandees:
        info = COVARIABLES_TAP_AUTORISEES.get(nom)
        if info is None:
            notes(f"⚠️ Covariable '{nom}' inconnue — ignorée.")
            continue
        col = info["colonne_attendue"]
        if col not in df_tap.columns:
            notes(f"⚠️ '{nom}' demandée mais colonne '{col}' absente des données — ignorée.")
            continue
        colonnes.append(col)
    notes(f"📋 Covariables retenues pour ajuster le modèle TAP : {colonnes or 'aucune'}.")
    return colonnes


def ajuster_poisson(df_tap: pd.DataFrame, covariables: list):
    formule = "n_poussees_fenetre ~ " + (" + ".join(covariables) if covariables else "1")
    modele = smf.glm(formule, data=df_tap, family=sm.families.Poisson(),
                      exposure=df_tap["exposition_annees"])
    return modele.fit()


def ajuster_binomiale_negative(df_tap: pd.DataFrame, covariables: list):
    formule = "n_poussees_fenetre ~ " + (" + ".join(covariables) if covariables else "1")
    modele = smf.negativebinomial(formule, data=df_tap, exposure=df_tap["exposition_annees"])
    return modele.fit(disp=0)


def test_surdispersion(resultat_poisson, df_tap: pd.DataFrame) -> dict:
    y = df_tap["n_poussees_fenetre"].values
    mu = resultat_poisson.fittedvalues.values
    g = ((y - mu) ** 2 - y) / mu
    aux = sm.OLS(g, mu).fit()
    coef, p_value = aux.params[0], aux.pvalues[0]
    residus_pearson = (y - mu) / np.sqrt(mu)
    ddl = len(y) - len(resultat_poisson.params)
    dispersion_pearson = float(np.sum(residus_pearson ** 2) / ddl) if ddl > 0 else np.nan
    return {"coef_auxiliaire": coef, "p_value": p_value,
            "surdispersion_significative": (coef > 0) and (p_value < 0.05),
            "dispersion_pearson_chi2_ddl": dispersion_pearson}


def tap_ajuste_avec_ic(resultat) -> tuple:
    pred = resultat.get_prediction()
    resume = pred.summary_frame(alpha=0.05)
    return resume["mean"].mean(), resume["mean_ci_lower"].mean(), resume["mean_ci_upper"].mean()


def comparer_poisson_nb(df_tap: pd.DataFrame, covariables: list, notes: Notes) -> dict:
    notes(f"Comparaison Poisson vs Binomiale Négative (offset = log(exposition), "
          f"covariables = {covariables or 'aucune'}).")
    res_poisson = ajuster_poisson(df_tap, covariables)
    res_nb = ajuster_binomiale_negative(df_tap, covariables)
    disp = test_surdispersion(res_poisson, df_tap)
    tap_p, ic_p_bas, ic_p_haut = tap_ajuste_avec_ic(res_poisson)
    tap_nb_moyen = np.exp(res_nb.predict(df_tap, exposure=np.ones(len(df_tap)))).mean()

    notes(f"Test de surdispersion : coef={disp['coef_auxiliaire']:.3f}, p={disp['p_value']:.4f}, "
          f"dispersion Pearson (χ²/ddl)={disp['dispersion_pearson_chi2_ddl']:.2f} "
          f"(référence Poisson = 1.0 ; > {SEUIL_DISPERSION_ALERTE} = surdispersion probable).")
    if disp["surdispersion_significative"] or disp["dispersion_pearson_chi2_ddl"] > SEUIL_DISPERSION_ALERTE:
        notes("➡️ Surdispersion détectée : la Binomiale Négative est recommandée.")
        recommandation = "nb"
    else:
        notes("➡️ Pas de surdispersion marquée : le Poisson est statistiquement défendable ici.")
        recommandation = "poisson"

    tableau_comparaison = pd.DataFrame({
        "Modèle": ["Poisson", "Binomiale Négative"],
        "AIC": [res_poisson.aic, res_nb.aic], "BIC": [res_poisson.bic, res_nb.bic],
        "LogLik": [res_poisson.llf, res_nb.llf],
        "alpha (NB)": [np.nan, res_nb.params.get("alpha", np.nan)],
        "TAP ajusté (n/an)": [tap_p, tap_nb_moyen],
    }).round(3)
    notes("Tableau de comparaison (voir tableau détaillé dans le zip) : AIC Poisson="
          f"{res_poisson.aic:.1f}, AIC NB={res_nb.aic:.1f}.")
    notes(f"TAP ajusté (Poisson), IC95% : [{ic_p_bas:.3f} ; {ic_p_haut:.3f}] poussées/an.")

    meilleur_aic = "nb" if res_nb.aic < res_poisson.aic else "poisson"
    notes(f"Modèle recommandé (surdispersion + AIC) : "
          f"{'Binomiale Négative' if recommandation == 'nb' else 'Poisson'}"
          f"{' (concorde avec le meilleur AIC)' if meilleur_aic == recommandation else ' (AIC en faveur de l’autre modèle — à arbitrer)'}.")

    return {"res_poisson": res_poisson, "res_nb": res_nb, "dispersion": disp,
            "tableau_comparaison": tableau_comparaison, "recommandation": recommandation,
            "tap_poisson_ic": (tap_p, ic_p_bas, ic_p_haut), "tap_nb_moyen": tap_nb_moyen}


def graphique_comparaison_tap(df_tap: pd.DataFrame, comparaison: dict):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    ax = axes[0]
    max_count = int(df_tap["n_poussees_fenetre"].max())
    bins = np.arange(0, max_count + 2) - 0.5
    ax.hist(df_tap["n_poussees_fenetre"], bins=bins, edgecolor="k", alpha=0.6,
            color="steelblue", label="Observé")
    ax.set_xlabel("Nombre de poussées dans la fenêtre précoce")
    ax.set_ylabel("Nombre de patients")
    ax.set_title("Distribution observée du nombre de poussées")
    ax.legend()

    ax = axes[1]
    res_p = comparaison["res_poisson"]
    ax.scatter(res_p.fittedvalues, df_tap["n_poussees_fenetre"], alpha=0.5,
               label="vs Poisson (ajusté)", color="darkorange")
    lim = max(df_tap["n_poussees_fenetre"].max(), res_p.fittedvalues.max()) + 1
    ax.plot([0, lim], [0, lim], color="grey", linestyle="--")
    ax.set_xlabel("Valeur prédite (moyenne du modèle)")
    ax.set_ylabel("Nombre de poussées observé")
    ax.set_title("Ajustement observé vs prédit (Poisson)")
    plt.tight_layout()
    return fig


def exclure_edss_post_poussee(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                               fenetre_mois: int, notes: Notes) -> pd.DataFrame:
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
    notes(f"📋 Fenêtre post-poussée = {fenetre_mois} mois : {n_exclus} mesure(s) EDSS "
          f"exclue(s) sur {len(df)} (proximité avec une poussée).")
    return df[~a_exclure].copy()


def preparer_dataset_modele_mixte(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                                   df_tap: pd.DataFrame, fenetre_post_poussee_mois: int,
                                   notes: Notes) -> pd.DataFrame:
    df = df_edss.merge(df_tap[["patient_id", "tap_empirique"]], on="patient_id", how="inner")
    n_sans_tap = df_edss["patient_id"].nunique() - df["patient_id"].nunique()
    if n_sans_tap > 0:
        notes(f"ℹ️ {n_sans_tap} patient(s) sans TAP calculable exclu(s) du modèle mixte.")

    df["temps_annees"] = (df["date_visite"] - df["date_onset"]).dt.days / 365.25
    n_avant = (df["temps_annees"] < 0).sum()
    if n_avant:
        notes(f"⚠️ {n_avant} visite(s) avec date_visite < date_onset retirée(s).")
        df = df[df["temps_annees"] >= 0]
    df["temps_annees_pos"] = df["temps_annees"] + EPSILON_TIME

    df = exclure_edss_post_poussee(df, df_poussees, fenetre_post_poussee_mois, notes)

    n_visites = df.groupby("patient_id").size()
    patients_valides = n_visites[n_visites >= 2].index
    n_retires = df["patient_id"].nunique() - len(patients_valides)
    if n_retires:
        notes(f"ℹ️ {n_retires} patient(s) avec <2 mesures EDSS retiré(s) (pas de trajectoire estimable).")
    df = df[df["patient_id"].isin(patients_valides)].copy()

    n_patients_final = df["patient_id"].nunique()
    n_points_final = len(df)
    duree_suivi_mediane = (df.groupby("patient_id")["temps_annees"].max().median()
                            if n_patients_final > 0 else np.nan)
    notes(f"📋 Données finales : {n_patients_final} patients, {n_points_final} points EDSS.")
    if not np.isnan(duree_suivi_mediane):
        notes(f"📋 Durée de suivi médiane par patient : {duree_suivi_mediane:.1f} ans.")

    if n_patients_final < MIN_PATIENTS_ALERTE or n_points_final < MIN_POINTS_ALERTE:
        notes(f"⚠️ Effectif limité pour un modèle mixte ({n_patients_final} patients / "
              f"{n_points_final} points, seuils indicatifs {MIN_PATIENTS_ALERTE}/{MIN_POINTS_ALERTE}).")

    notes("ℹ️ Rappel littérature pédiatrie : la SEP pédiatrique présente un découplage partiel "
          "entre fréquence des poussées et EDSS (TAP plus élevé mais récupération souvent "
          "meilleure). Un effet du TAP non significatif est cohérent avec ce phénomène documenté, "
          "pas nécessairement une absence de lien biologique.")
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


def ajuster_modele_mixte(df: pd.DataFrame, transformation_temps: str, reml: bool, notes: Notes):
    df = df.copy()
    colonnes_temps = obtenir_colonnes_temps(df, transformation_temps)
    termes_interaction = " + ".join(f"tap_empirique * {c}" for c in colonnes_temps)
    formule = f"edss ~ {termes_interaction}"
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
                notes(f"ℹ️ Échec REML ({e}) — bascule sur ML.")
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
            notes(f"ℹ️ Pente aléatoire : échec ({e}) — repli sur intercept aléatoire seul.")
            resultat = None

    if resultat is None:
        resultat, reml_effectif = _fit(None, reml)
        type_modele = "intercept aléatoire seul"

    if reml_effectif != reml:
        type_modele += " [REML→ML]"
    return resultat, type_modele, df


def choisir_meilleure_transformation_temps(df: pd.DataFrame, notes: Notes) -> pd.DataFrame:
    lignes = []
    for transfo in ["lineaire", "racine", "log", "combinee"]:
        try:
            resultat, type_modele, _ = ajuster_modele_mixte(df, transfo, reml=False, notes=notes)
            lignes.append({"transformation": transfo, "type_modele": type_modele,
                            "aic": resultat.aic, "log_vraisemblance": resultat.llf,
                            "converged": resultat.converged})
        except Exception as e:
            lignes.append({"transformation": transfo, "type_modele": "échec", "aic": np.nan,
                            "log_vraisemblance": np.nan, "converged": False})
            notes(f"⚠️ Échec transformation={transfo} : {e}")

    tableau = pd.DataFrame(lignes).sort_values("aic")
    if tableau["aic"].isna().all():
        raise ValueError(
            "Aucune transformation du temps n'a permis d'ajuster le modèle mixte "
            "(échec de convergence sur les 4 transformations testées). Effectif "
            "probablement trop faible pour ce modèle."
        )
    notes(f"📋 Transformation retenue (AIC minimal) : {tableau.iloc[0]['transformation']}.")
    return tableau


def effet_par_unite_tap(resultat, t: float, transformation_temps: str) -> tuple:
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

    params, cov = resultat.params, resultat.cov_params()
    noms = list(params.index)
    L = np.zeros(len(noms))
    L[noms.index("tap_empirique")] = 1.0
    for col_temps, val in t_f_par_terme.items():
        nom_int = f"tap_empirique:{col_temps}"
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
              f"({suivi_max_observe:.1f} ans) — IC95% à interpréter avec prudence.")

    lignes = []
    for t in (0,) + tuple(horizons_annees):
        effet, se, ic_inf, ic_sup, p = effet_par_unite_tap(resultat, t, transformation_temps)
        lignes.append({
            "horizon_annees": t, "effet_par_poussee_an": round(effet, 3),
            "erreur_standard": round(se, 3), "IC95_inf": round(ic_inf, 3),
            "IC95_sup": round(ic_sup, 3), "p_value": round(p, 4) if not np.isnan(p) else None,
            "significatif_5pct": bool(p < 0.05) if not np.isnan(p) else None,
            "extrapolation_hors_suivi": (t in horizons_extrapoles),
        })
    tableau = pd.DataFrame(lignes)

    derniere = tableau.iloc[-1]
    sig_txt = ("statistiquement significatif" if derniere["significatif_5pct"]
               else "non significatif avec cet effectif — cf. découplage TAP/EDSS pédiatrique")
    notes(f"➡️ À {int(derniere['horizon_annees'])} ans de suivi, chaque poussée/an "
          f"supplémentaire durant la fenêtre précoce est associée à une variation moyenne de "
          f"{derniere['effet_par_poussee_an']:.2f} point(s) d'EDSS "
          f"[IC95% {derniere['IC95_inf']:.2f} ; {derniere['IC95_sup']:.2f}] "
          f"(p={derniere['p_value']:.3f}, {sig_txt}).")
    return tableau


def tracer_trajectoires_par_tap(df: pd.DataFrame, resultat, transformation_temps: str):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    tertiles = df.drop_duplicates("patient_id")["tap_empirique"].quantile([1/3, 2/3]).values

    def groupe_tap(v):
        if v <= tertiles[0]:
            return "TAP bas"
        elif v <= tertiles[1]:
            return "TAP moyen"
        return "TAP élevé"

    couleurs = {"TAP bas": "#2166ac", "TAP moyen": "#8c8c8c", "TAP élevé": "#b2182b"}
    ax = axes[0]
    for pid, groupe in df.groupby("patient_id"):
        groupe = groupe.sort_values("temps_annees")
        cat = groupe_tap(groupe["tap_empirique"].iloc[0])
        ax.plot(groupe["temps_annees"], groupe["edss"], color=couleurs[cat], alpha=0.25, linewidth=0.8)
    for cat, coul in couleurs.items():
        ax.plot([], [], color=coul, label=cat)
    ax.set_xlabel("Temps depuis l'onset (années)")
    ax.set_ylabel("EDSS")
    ax.set_title("Trajectoires individuelles par tertile de TAP précoce")
    ax.legend()

    ax = axes[1]
    t_range = np.linspace(0, df["temps_annees"].max(), 100)
    if transformation_temps == "lineaire":
        termes_temps = {"temps_f": t_range}
    elif transformation_temps == "racine":
        termes_temps = {"temps_f": np.sqrt(t_range + EPSILON_TIME)}
    elif transformation_temps == "log":
        termes_temps = {"temps_f": np.log(t_range + EPSILON_TIME)}
    else:
        termes_temps = {"temps_f_racine": np.sqrt(t_range + EPSILON_TIME),
                         "temps_f_log": np.log(t_range + EPSILON_TIME)}

    params = resultat.params
    tap_reference = {"TAP bas": tertiles[0] / 2, "TAP moyen": (tertiles[0] + tertiles[1]) / 2,
                      "TAP élevé": tertiles[1] * 1.5}
    for cat, tap_val in tap_reference.items():
        edss_pred = params.get("Intercept", 0) + params.get("tap_empirique", 0) * tap_val
        for col_temps, t_f in termes_temps.items():
            edss_pred = (edss_pred + params.get(col_temps, 0) * t_f
                         + params.get(f"tap_empirique:{col_temps}", 0) * tap_val * t_f)
        ax.plot(t_range, edss_pred, color=couleurs[cat], linewidth=2.5, label=cat)
    ax.set_xlabel("Temps depuis l'onset (années)")
    ax.set_ylabel("EDSS prédit")
    ax.set_title("Trajectoire moyenne prédite selon le TAP précoce")
    ax.legend()
    plt.tight_layout()
    return fig


def calculer_diagnostics(resultat, df: pd.DataFrame, notes: Notes) -> dict:
    predictions = resultat.fittedvalues
    residus = df["edss"].values - predictions.values
    rmse = float(np.sqrt(np.mean(residus ** 2)))
    pwpe = float(np.mean(np.abs(residus) <= 0.5) * 100)
    pope = float(np.mean(np.abs(residus) > 2.0) * 100)
    notes(f"📋 Diagnostics modèle mixte : RMSE={rmse:.3f} pts EDSS, "
          f"{pwpe:.1f}% des prédictions à ±0.5 pt, {pope:.1f}% à plus de ±2 pts.")
    return {"RMSE": rmse, "PWPE_pct": pwpe, "POPE_pct": pope}


def run(engine, config: dict) -> dict:
    """Point d'entrée appelé par l'API. `config` = corps JSON envoyé par React."""
    notes = Notes()
    horizons_annees = tuple(config.get("horizons_annees", HORIZONS_CLINIQUES_DEFAUT))

    df_edss = charger_edss(engine, notes)
    df_poussees = charger_poussees(engine, notes)
    if df_edss.empty:
        raise ValueError("Aucune visite EDSS exploitable dans la base pour ce test.")

    fenetre_tap = resoudre_fenetre_tap(config, notes)
    df_tap = calculer_tap_par_patient(df_edss, df_poussees, fenetre_tap, notes)
    if df_tap.empty:
        raise ValueError("Aucun patient avec une exposition suffisante pour calculer le TAP précoce.")

    covariables_patients = charger_covariables_patients(engine, notes)
    df_tap = df_tap.merge(
        covariables_patients[["patient_id", "age_onset_annees", "sexe", "edss_inclusion"]],
        on="patient_id", how="left",
    )

    covariables_tap = resoudre_covariables_tap(config, df_tap, notes)
    comparaison = comparer_poisson_nb(df_tap, covariables_tap, notes)
    fig1 = graphique_comparaison_tap(df_tap, comparaison)

    modele_tap_choisi = config.get("modele_tap") or comparaison["recommandation"]
    if modele_tap_choisi not in ("poisson", "nb"):
        modele_tap_choisi = comparaison["recommandation"]
    tap_val, tap_ic_bas, tap_ic_haut = (
        comparaison["tap_poisson_ic"] if modele_tap_choisi == "poisson"
        else (comparaison["tap_nb_moyen"], None, None)
    )

    fenetre_post_poussee = FENETRE_POST_POUSSEE_DEFAUT_MOIS
    df_modele = preparer_dataset_modele_mixte(df_edss, df_poussees, df_tap, fenetre_post_poussee, notes)
    if df_modele.empty or df_modele["patient_id"].nunique() < 2:
        raise ValueError(
            "Effectif insuffisant après nettoyage pour ajuster le modèle mixte EDSS(t) "
            "(moins de 2 patients avec au moins 2 mesures EDSS exploitables). "
            "Élargissez la fenêtre TAP ou réduisez la fenêtre post-poussée."
        )

    tableau_transfos = choisir_meilleure_transformation_temps(df_modele, notes)
    meilleure_transfo = tableau_transfos.iloc[0]["transformation"]

    resultat, type_modele, df_final = ajuster_modele_mixte(df_modele, meilleure_transfo, reml=True, notes=notes)
    notes(f"📋 Modèle mixte final : {type_modele} (convergence={resultat.converged}).")

    diagnostics = calculer_diagnostics(resultat, df_final, notes)

    suivi_max = df_final["temps_annees"].max()
    tableau_effets = interpreter_effet_clinique(
        resultat, meilleure_transfo, horizons_annees=horizons_annees,
        suivi_max_observe=suivi_max, notes=notes,
    )

    fig2 = tracer_trajectoires_par_tap(df_final, resultat, meilleure_transfo)
    figures = [figure_to_base64(fig1), figure_to_base64(fig2)]

    derniere = tableau_effets.iloc[-1]
    resume_stats = {
        "tap_ajuste": round(float(tap_val), 3),
        "modele_tap": "Poisson" if modele_tap_choisi == "poisson" else "Binomiale Négative",
        "effet_tap_edss": derniere["effet_par_poussee_an"],
        "p_value": derniere["p_value"],
        "n_patients": int(df_final["patient_id"].nunique()),
        "rmse": round(diagnostics["RMSE"], 3),
    }

    return {
        "notes": notes.lines,
        "figures": figures,
        "tableau": tableau_effets.to_dict(orient="records"),
        "resume_stats": resume_stats,
    }

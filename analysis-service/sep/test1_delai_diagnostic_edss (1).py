"""
Refactor de test_analyse_statistique/SEP/test1_sep.py (délai diagnostique
vs pronostic EDSS) en fonction appelable par l'API, sans input() ni plt.show().

La logique statistique (requêtes SQL, régression, VIF, Spearman...) est
STRICTEMENT IDENTIQUE au script original — seule l'interface change :
  - la config vient du frontend au lieu du clavier
  - les print() vont dans `notes`
  - les figures sont encodées en base64 au lieu de s'afficher
"""
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.outliers_influence import variance_inflation_factor
from scipy import stats
from scipy.stats import spearmanr
from sklearn.metrics import roc_curve, roc_auc_score, confusion_matrix
from sqlalchemy import text
import matplotlib.pyplot as plt

from common import figure_to_base64, Notes

COVARIABLES_DISPONIBLES = {
    "age_diagnostic_mois": {"table": "sep_identification_clinique"},
    "sexe": {"table": "sep_identification_clinique"},
    "forme_evolutive": {"table": "sep_evolution"},
    "recuperation_complete": {"table": "sep_presentation_initiale"},
    "type_premier_evenement": {"table": "sep_presentation_initiale"},
    "nb_lesions_t2_diagnostic": {"table": "sep_irm"},
    "consanguinite_parentale": {"table": "sep_antecedents"},
}

COLONNES_AVEC_NA_LITTERAL = {"recuperation_complete", "forme_evolutive"}

# Décrit le formulaire attendu côté React (voir AnalyseStatistiqueTab.jsx)
PARAMETRES_SCHEMA = {
    "type_regression": {"type": "select", "options": ["linear", "logistic"], "label": "Type de régression"},
    "horizon_annees": {"type": "select", "options": [2, 3, 4], "allow_custom": True, "label": "Horizon EDSS (années)"},
    "tolerance_mois": {"type": "select", "options": [3, 6, 9, 12, 18, 24], "label": "Fenêtre de tolérance (mois)"},
    "seuil_logistique": {"type": "number", "default": 3.0, "required_if": "type_regression=logistic", "label": "Seuil EDSS mauvais pronostic"},
    "mode_analyse": {"type": "select", "options": ["univariee", "multivariee"], "label": "Mode"},
    "covariables": {"type": "multiselect", "options": list(COVARIABLES_DISPONIBLES.keys()), "label": "Covariables (si multivariée)"},
}


def charger_donnees(engine, notes: Notes):
    requete = text("""
        SELECT
            ic.pseudonyme, ic.delai_diagnostic_mois, ic.date_diagnostic,
            ic.age_diagnostic_mois, ic.age_premier_symptome_mois, ic.sexe,
            ev.forme_evolutive, pi.type_premier_evenement,
            pi.recuperation_complete, an.consanguinite_parentale
        FROM sep_identification_clinique ic
        JOIN patients p ON p.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_evolution ev ON ev.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_presentation_initiale pi ON pi.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_antecedents an ON an.pseudonyme = ic.pseudonyme
        WHERE p.registre = 'SEP' AND ic.delai_diagnostic_mois IS NOT NULL
    """)
    df = pd.read_sql(requete, engine)
    df = df.rename(columns={"date_diagnostic": "date_ancrage_diagnostic"})

    for col in COLONNES_AVEC_NA_LITTERAL:
        if col in df.columns:
            n_na = (df[col] == "NA").sum()
            if n_na:
                notes(f"ℹ️ {n_na} valeur(s) 'NA' détectée(s) dans {col} → traitées comme manquantes.")
            df.loc[df[col] == "NA", col] = np.nan

    notes(f"✅ Dataset patient-niveau construit : {df.shape[0]} patients, {df.shape[1]} colonnes.")
    return df


def extraire_edss_horizon(engine, pseudonymes, df_ancrage, horizon_annees, tolerance_mois, notes: Notes):
    requete = text("""
        SELECT pseudonyme, date_visite, score_edss
        FROM sep_edss_visites
        WHERE pseudonyme = ANY(:pseudos) AND score_edss IS NOT NULL
    """)
    visites = pd.read_sql(requete, engine, params={"pseudos": list(pseudonymes)})
    visites["date_visite"] = pd.to_datetime(visites["date_visite"])

    d = df_ancrage[["pseudonyme", "date_ancrage_diagnostic"]].dropna().copy()
    d["date_ancrage_diagnostic"] = pd.to_datetime(d["date_ancrage_diagnostic"])
    d["date_cible"] = d["date_ancrage_diagnostic"] + pd.DateOffset(years=int(horizon_annees))

    fusion = visites.merge(d, on="pseudonyme", how="inner")
    fusion["ecart_jours"] = (fusion["date_visite"] - fusion["date_cible"]).dt.days.abs()
    fusion = fusion[fusion["ecart_jours"] <= tolerance_mois * 30.44]
    fusion = fusion.sort_values("ecart_jours").drop_duplicates("pseudonyme", keep="first")

    resultat = fusion[["pseudonyme", "score_edss"]].rename(
        columns={"score_edss": f"edss_a_{int(horizon_annees)}_ans"}
    )
    n_total, n_trouve = len(pseudonymes), len(resultat)
    notes(f"📋 EDSS à {horizon_annees} an(s) (± {tolerance_mois} mois) : {n_trouve}/{n_total} patients disponibles.")
    if n_total - n_trouve > 0:
        notes(f"⚠️ {n_total - n_trouve} patient(s) exclu(s) faute de visite EDSS proche de l'horizon "
              "— vérifier un biais de perdus de vue.")
    return resultat


def extraire_nb_lesions_t2_diagnostic(engine, pseudonymes, df_ancrage, tolerance_mois=3):
    requete = text("""
        SELECT pseudonyme, date_examen, nb_lesions_t2
        FROM sep_irm WHERE pseudonyme = ANY(:pseudos) AND nb_lesions_t2 IS NOT NULL
    """)
    irms = pd.read_sql(requete, engine, params={"pseudos": list(pseudonymes)})
    irms["date_examen"] = pd.to_datetime(irms["date_examen"])
    d = df_ancrage[["pseudonyme", "date_ancrage_diagnostic"]].dropna().copy()
    d["date_ancrage_diagnostic"] = pd.to_datetime(d["date_ancrage_diagnostic"])
    fusion = irms.merge(d, on="pseudonyme", how="inner")
    fusion["ecart_jours"] = (fusion["date_examen"] - fusion["date_ancrage_diagnostic"]).dt.days.abs()
    fusion = fusion[fusion["ecart_jours"] <= tolerance_mois * 30.44]
    fusion = fusion.sort_values("ecart_jours").drop_duplicates("pseudonyme", keep="first")
    return fusion[["pseudonyme", "nb_lesions_t2"]].rename(columns={"nb_lesions_t2": "nb_lesions_t2_diagnostic"})


def preparer_dataset_modele(df, config, notes: Notes):
    df = df.copy()
    df["_delai_mois"] = df["delai_diagnostic_mois"]
    variables = ["_delai_mois", config["col_edss"]] + config["covariables"]
    d = df[variables].copy()

    cat_cols = [c for c in config["covariables"] if d[c].dtype == "object"]
    if cat_cols:
        d = pd.get_dummies(d, columns=cat_cols, drop_first=True)
    for c in d.columns:
        d[c] = pd.to_numeric(d[c], errors="coerce")

    n_avant = len(d)
    d = d.dropna()
    n_exclus = n_avant - len(d)
    notes(f"📋 Effectif avant exclusion : n={n_avant}")
    if n_exclus > 0:
        notes(f"⚠️ {n_exclus} patient(s) exclu(s) pour donnée(s) manquante(s) "
              f"({n_exclus / n_avant * 100:.1f}%) — vérifier un biais de sélection.")
    notes(f"📋 Effectif final utilisé : n={len(d)}")

    if config["type_regression"] == "logistic":
        d["_outcome"] = (d[config["col_edss"]] >= config["seuil_logistique"]).astype(int)
    else:
        d["_outcome"] = d[config["col_edss"]]
    return d


def run(engine, config: dict) -> dict:
    """Point d'entrée appelé par l'API. `config` = corps JSON envoyé par React."""
    notes = Notes()
    df = charger_donnees(engine, notes)
    if df.empty:
        raise ValueError("Aucun patient SEP avec délai diagnostique renseigné dans la base.")

    horizon_annees = int(config.get("horizon_annees", 3))
    tolerance_mois = int(config.get("tolerance_mois", 6))
    type_regression = config.get("type_regression", "linear")
    seuil_logistique = float(config.get("seuil_logistique", 3.0))
    covariables = config.get("covariables", []) if config.get("mode_analyse") == "multivariee" else []

    edss_horizon = extraire_edss_horizon(engine, df["pseudonyme"], df, horizon_annees, tolerance_mois, notes)
    col_edss = f"edss_a_{horizon_annees}_ans"
    df = df.merge(edss_horizon, on="pseudonyme", how="left")

    if "nb_lesions_t2_diagnostic" in covariables:
        irm_diag = extraire_nb_lesions_t2_diagnostic(engine, df["pseudonyme"], df)
        df = df.merge(irm_diag, on="pseudonyme", how="left")

    model_config = {
        "type_regression": type_regression, "col_edss": col_edss,
        "horizon_edss": f"{horizon_annees} ans", "seuil_logistique": seuil_logistique,
        "covariables": covariables,
    }
    d = preparer_dataset_modele(df, model_config, notes)
    if len(d) < 15:
        raise ValueError(f"Effectif insuffisant après nettoyage (n={len(d)}) pour ajuster un modèle fiable.")

    predicteurs = ["_delai_mois"] + [c for c in d.columns if c not in ["_delai_mois", col_edss, "_outcome"]]
    formule = "_outcome ~ " + " + ".join(predicteurs)
    notes(f"Formule du modèle : {formule}")

    # VIF si multivarié
    if len(predicteurs) > 1:
        X = sm.add_constant(d[predicteurs].astype(float))
        vifs = pd.Series([variance_inflation_factor(X.values, i) for i in range(X.shape[1])], index=X.columns)
        if (vifs.drop("const") > 5).any():
            notes("⚠️ VIF > 5 détecté : forte colinéarité entre certaines covariables.")

    rho, p_spearman = spearmanr(d["_delai_mois"], d[col_edss])
    notes(f"Corrélation de Spearman (brute) : ρ={rho:.3f}, p={p_spearman:.4f}")

    figures = []
    tableau_or = None

    if type_regression == "linear":
        modele = smf.ols(formule, data=d).fit()
        beta, pval = modele.params["_delai_mois"], modele.pvalues["_delai_mois"]
        ci = modele.conf_int().loc["_delai_mois"]
        notes(f"β(délai) = {beta:.4f}, IC95% [{ci[0]:.4f};{ci[1]:.4f}], p={pval:.4f}")

        fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
        axes[0].scatter(d["_delai_mois"], d["_outcome"], alpha=0.6, edgecolor="k")
        x_range = np.linspace(d["_delai_mois"].min(), d["_delai_mois"].max(), 100)
        pred_df = pd.DataFrame({"_delai_mois": x_range})
        for col in d.columns:
            if col not in ["_delai_mois", "_outcome", col_edss]:
                pred_df[col] = d[col].mean()
        axes[0].plot(x_range, modele.predict(pred_df), color="red", lw=2)
        axes[0].set_xlabel("Délai diagnostique (mois)"); axes[0].set_ylabel(col_edss)
        axes[0].set_title("Délai vs EDSS")
        axes[1].scatter(modele.fittedvalues, modele.resid, alpha=0.6, edgecolor="k")
        axes[1].axhline(0, color="red", linestyle="--")
        axes[1].set_title("Résidus vs ajustés")
        figures.append(figure_to_base64(fig))

        resume_stats = {"beta_delai": round(beta, 4), "p_value": round(pval, 4),
                         "ic95": [round(ci[0], 4), round(ci[1], 4)], "n": len(d)}
    else:
        modele = smf.logit(formule, data=d).fit(disp=0)
        or_table = pd.DataFrame({
            "OR": np.exp(modele.params), "IC95%_bas": np.exp(modele.conf_int()[0]),
            "IC95%_haut": np.exp(modele.conf_int()[1]), "p": modele.pvalues,
        }).round(4)
        tableau_or = or_table.reset_index().rename(columns={"index": "variable"}).to_dict(orient="records")

        y_true, y_score = d["_outcome"], modele.predict(d)
        fpr, tpr, _ = roc_curve(y_true, y_score)
        auc = roc_auc_score(y_true, y_score)
        notes(f"AUC (ROC) = {auc:.3f}")

        fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
        axes[0].plot(fpr, tpr, color="darkorange", lw=2, label=f"AUC={auc:.3f}")
        axes[0].plot([0, 1], [0, 1], "--", color="grey")
        axes[0].set_title("Courbe ROC"); axes[0].legend()
        cm = confusion_matrix(y_true, (y_score >= 0.5).astype(int))
        axes[1].imshow(cm, cmap="Blues")
        for i in range(2):
            for j in range(2):
                axes[1].text(j, i, cm[i, j], ha="center", va="center")
        axes[1].set_title("Matrice de confusion (seuil 0.5)")
        figures.append(figure_to_base64(fig))

        resume_stats = {"or_delai": round(np.exp(modele.params["_delai_mois"]), 4),
                         "p_value": round(modele.pvalues["_delai_mois"], 4),
                         "auc": round(auc, 3), "n": len(d)}

    return {
        "notes": notes.lines,
        "figures": figures,
        "tableau": tableau_or,       # null si régression linéaire
        "resume_stats": resume_stats,
        "spearman": {"rho": round(rho, 3), "p": round(p_spearman, 4)},
    }
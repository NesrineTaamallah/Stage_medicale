
import os
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import matplotlib.pyplot as plt
import seaborn as sns
from sqlalchemy import create_engine, text
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import proportional_hazard_test

sns.set_style("whitegrid")

def get_engine():
    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    dbname = os.environ.get("PGDATABASE", "neuroexo")
    user = os.environ.get("PGUSER", "postgres")
    password = os.environ.get("PGPASSWORD", "")
    url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"
    return create_engine(url)

def rapport_valeurs_manquantes(df, colonnes):
    
    print("-" * 70)
    print("Rapport valeurs manquantes (convention NULL vs 'NA')")
    print("-" * 70)
    for col in colonnes:
        if col not in df.columns:
            print(f"  {col:35s} : colonne absente du jeu de données")
            continue
        n_total = len(df)
        n_null = df[col].isna().sum()
        n_na_texte = (df[col].astype(str) == "NA").sum()
        n_valide = n_total - n_null - n_na_texte
        print(f"  {col:35s} : {n_valide} valides | {n_null} non renseignés (NULL) "
              f"| {n_na_texte} non applicables ('NA', détectable seulement si "
              f"colonne catégorielle)")
    print()


def filtrer_non_manquant(df, colonnes):
    
    masque = pd.Series(True, index=df.index)
    for col in colonnes:
        masque &= df[col].notna()
        masque &= (df[col].astype(str) != "NA")
    return df.loc[masque].copy()


CHAMPS_REGISTRE_SEP = {
    "age_diagnostic_mois":        "sep_identification_clinique.age_diagnostic_mois",
    "age_premier_symptome_mois":  "sep_identification_clinique.age_premier_symptome_mois",
    "sexe":                       "sep_identification_clinique.sexe",
    "delai_diagnostic_mois":      "sep_identification_clinique.delai_diagnostic_mois (colonne générée)",
    "recuperation_complete":      "sep_presentation_initiale.recuperation_complete",
    "tap_moyen":                  "analytics.v_sep_tap_annuel.tap (agrégé sur la période)",
    "edss_baseline":              "DÉRIVÉ de sep_edss_visites (visite la plus proche de date_diagnostic)",
    "forme_evolutive":            "sep_evolution.forme_evolutive",
    "nb_lesions_t2":              "sep_irm.nb_lesions_t2 (IRM initiale = MIN(date_examen))",
    "prise_contraste_gd":         "sep_irm.prise_contraste_gd (IRM initiale)",
    "bandes_oligoclonales":       "sep_biologie_lcr.bandes_oligoclonales (1er prélèvement)",
    "index_igg":                  "sep_biologie_lcr.index_igg (1er prélèvement)",
}

CHAMPS_LITTERATURE = {
    "age_diagnostic_mois", "age_premier_symptome_mois", "sexe", "delai_diagnostic_mois",
    "edss_baseline", "forme_evolutive", "nb_lesions_t2", "bandes_oligoclonales", "tap_moyen",
}

COVARIABLES_AUTORISEES = sorted(set(CHAMPS_REGISTRE_SEP) & CHAMPS_LITTERATURE)

HORIZONS_ENCADRANTE = {2: "edss_2ans", 5: "edss_5ans"}

FENETRE_TAP_PRECOCE_ANNEES = 1

COVARIABLES_POST_BASELINE_COX = {"tap_moyen"}

SQL_BASE = """
-- Table pivot + identification clinique (registre SEP uniquement)
-- date_diagnostic = vrai repère t=0 du Test #4 ("au diagnostic"), PAS date_inclusion
-- [CORRECTIF #2] date_diagnostic confirmée existante dans la vraie base (colonne
-- non documentée dans le dictionnaire .md fourni, mais présente en Postgres).
-- On exclut ici explicitement les patients pour qui elle est NULL : sans cette
-- date, aucune fenêtre temporelle du Test #4 (IRM initiale, EDSS à horizon,
-- TAP précoce, temps jusqu'à progression) n'est calculable pour ce patient.
SELECT
    p.pseudonyme,
    p.date_inclusion,
    ic.date_diagnostic,
    ic.age_diagnostic_mois,
    ic.age_premier_symptome_mois,
    ic.delai_diagnostic_mois,      -- colonne générée, ne jamais la recalculer
    ic.sexe,
    ic.gouvernorat_code
FROM patients p
JOIN sep_identification_clinique ic ON ic.pseudonyme = p.pseudonyme
WHERE p.registre = 'SEP'
  AND ic.date_diagnostic IS NOT NULL
"""

SQL_PRESENTATION = """
SELECT pseudonyme, recuperation_complete
FROM sep_presentation_initiale
"""

SQL_EVOLUTION = """
SELECT pseudonyme, forme_evolutive, date_conversion_sp
FROM sep_evolution
"""

SQL_IRM_INITIALE = """
SELECT DISTINCT ON (i.pseudonyme)
    i.pseudonyme, i.date_examen, i.nb_lesions_t2, i.prise_contraste_gd,
    ic.date_diagnostic
FROM sep_irm i
JOIN sep_identification_clinique ic ON ic.pseudonyme = i.pseudonyme
WHERE ic.date_diagnostic IS NOT NULL
ORDER BY i.pseudonyme, ABS(EXTRACT(EPOCH FROM (i.date_examen - ic.date_diagnostic))), i.date_examen ASC
"""

SQL_LCR_INITIAL = """
SELECT DISTINCT ON (l.pseudonyme)
    l.pseudonyme, l.date_prelevement, l.bandes_oligoclonales, l.index_igg,
    ic.date_diagnostic
FROM sep_biologie_lcr l
JOIN sep_identification_clinique ic ON ic.pseudonyme = l.pseudonyme
WHERE ic.date_diagnostic IS NOT NULL
ORDER BY l.pseudonyme, ABS(EXTRACT(EPOCH FROM (l.date_prelevement - ic.date_diagnostic))), l.date_prelevement ASC
"""

SQL_EDSS_VISITES = """
SELECT pseudonyme, date_visite, score_edss
FROM sep_edss_visites
ORDER BY pseudonyme, date_visite ASC
"""

SQL_TAP_ANNUEL = """
SELECT pseudonyme, annee, tap
FROM analytics.v_sep_tap_annuel
"""

SQL_SUIVI = """
SELECT pseudonyme, date_dernier_suivi, statut_dernier_suivi, score_edss_dernier
FROM sep_suivi
"""


def extraire_donnees_brutes(engine):
    
    with engine.connect() as conn:
        df_base = pd.read_sql(text(SQL_BASE), conn)
        df_presentation = pd.read_sql(text(SQL_PRESENTATION), conn)
        df_evolution = pd.read_sql(text(SQL_EVOLUTION), conn)
        df_irm = pd.read_sql(text(SQL_IRM_INITIALE), conn)
        df_lcr = pd.read_sql(text(SQL_LCR_INITIAL), conn)
        df_edss = pd.read_sql(text(SQL_EDSS_VISITES), conn)
        df_tap = pd.read_sql(text(SQL_TAP_ANNUEL), conn)
        df_suivi = pd.read_sql(text(SQL_SUIVI), conn)

    with engine.connect() as conn:
        total_sep = pd.read_sql(
            text("SELECT COUNT(*) AS n FROM patients WHERE registre = 'SEP'"), conn
        )["n"].iloc[0]
    n_exclus = int(total_sep) - len(df_base)
    if n_exclus > 0:
        print(f"[AVERTISSEMENT] {n_exclus} patient(s) SEP exclu(s) du Test #4 : "
              f"date_diagnostic non renseignée (NULL). "
              f"{len(df_base)}/{total_sep} patients conservés.\n")

    return {
        "base": df_base, "presentation": df_presentation, "evolution": df_evolution,
        "irm": df_irm, "lcr": df_lcr, "edss": df_edss, "tap": df_tap, "suivi": df_suivi,
    }


TOLERANCE_IRM_JOURS = 180
TOLERANCE_LCR_JOURS = 180


def deriver_edss_a_horizon(df_base, df_edss, horizon_annees, tolerance_jours=90):
    
    resultats = []
    for _, row in df_base.iterrows():
        pseudo = row["pseudonyme"]
        
        if pd.isna(row["date_diagnostic"]):
            resultats.append({"pseudonyme": pseudo, "edss_valeur": np.nan})
            continue
        cible = row["date_diagnostic"] + pd.DateOffset(years=horizon_annees)
        visites = df_edss[df_edss["pseudonyme"] == pseudo].copy()
        if visites.empty:
            resultats.append({"pseudonyme": pseudo, "edss_valeur": np.nan})
            continue
        visites["ecart_jours"] = (visites["date_visite"] - cible).abs().dt.days
        plus_proche = visites.loc[visites["ecart_jours"].idxmin()]
        if plus_proche["ecart_jours"] <= tolerance_jours:
            resultats.append({"pseudonyme": pseudo, "edss_valeur": plus_proche["score_edss"]})
        else:
            resultats.append({"pseudonyme": pseudo, "edss_valeur": np.nan})
    return pd.DataFrame(resultats)


def deriver_edss_baseline(df_base, df_edss, tolerance_jours=60):
    return deriver_edss_a_horizon(df_base, df_edss, horizon_annees=0, tolerance_jours=tolerance_jours) \
        .rename(columns={"edss_valeur": "edss_baseline"})


def appliquer_tolerance_examen_initial(df, col_date_examen, colonnes_a_invalider, date_ref_col="date_diagnostic",
                                        tolerance_jours=180):
    
    ecart = (df[col_date_examen] - df[date_ref_col]).abs().dt.days
    hors_tolerance = ecart > tolerance_jours
    for col in colonnes_a_invalider:
        df.loc[hors_tolerance, col] = np.nan
    return df


def agreger_tap(df_base, df_tap, horizon_annees):
    resultats = []
    for _, row in df_base.iterrows():
        pseudo = row["pseudonyme"]
        if pd.isna(row["date_diagnostic"]):
            resultats.append({"pseudonyme": pseudo, "tap_moyen": np.nan})
            continue
        annee_debut = row["date_diagnostic"].year
        annee_fin = annee_debut + horizon_annees - 1
        sous = df_tap[(df_tap["pseudonyme"] == pseudo) &
                       (df_tap["annee"] >= annee_debut) &
                       (df_tap["annee"] <= annee_fin)]
        tap_moyen = sous["tap"].mean() if not sous.empty else np.nan
        resultats.append({"pseudonyme": pseudo, "tap_moyen": tap_moyen})
    return pd.DataFrame(resultats)


def detecter_progression_confirmee(df_base, df_edss, df_suivi, edss_baseline_col="edss_baseline"):
    resultats = []
    for _, row in df_base.iterrows():
        pseudo = row["pseudonyme"]
        date_diagnostic = row["date_diagnostic"]
        if pd.isna(date_diagnostic):
            resultats.append({"pseudonyme": pseudo, "temps_progression": np.nan,
                               "evenement_progression": np.nan})
            continue

        baseline_rows = df_base.loc[df_base["pseudonyme"] == pseudo, edss_baseline_col]
        baseline = baseline_rows.values[0] if len(baseline_rows) else np.nan

        visites = df_edss[df_edss["pseudonyme"] == pseudo].sort_values("date_visite")
        suivi_row = df_suivi[df_suivi["pseudonyme"] == pseudo]

        if pd.isna(baseline) or visites.empty:
            resultats.append({"pseudonyme": pseudo, "temps_progression": np.nan,
                               "evenement_progression": np.nan})
            continue

        seuil = 0.5 if baseline >= 6 else 1.0
        cible = baseline + seuil

        evenement_trouve = False
        temps_evenement = np.nan
        visites_list = visites.to_dict("records")
        for i, v in enumerate(visites_list):
            if v["score_edss"] >= cible:
                for v2 in visites_list[i + 1:]:
                    ecart_mois = (v2["date_visite"] - v["date_visite"]).days / 30.44
                    if ecart_mois >= 3 and v2["score_edss"] >= cible:
                        evenement_trouve = True
                        temps_evenement = (v["date_visite"] - date_diagnostic).days / 365.25
                        break
            if evenement_trouve:
                break

        if evenement_trouve:
            resultats.append({"pseudonyme": pseudo, "temps_progression": temps_evenement,
                               "evenement_progression": 1})
        else:
            if not suivi_row.empty and pd.notna(suivi_row["date_dernier_suivi"].values[0]):
                date_fin = suivi_row["date_dernier_suivi"].values[0]
                temps_censure = (pd.Timestamp(date_fin) - date_diagnostic).days / 365.25
            else:
                temps_censure = np.nan
            resultats.append({"pseudonyme": pseudo, "temps_progression": temps_censure,
                               "evenement_progression": 0})
    return pd.DataFrame(resultats)


def construire_dataframe_analyse(engine):
    
    brut = extraire_donnees_brutes(engine)
    df = brut["base"].copy()

    df = df.merge(brut["presentation"], on="pseudonyme", how="left")
    df = df.merge(brut["evolution"], on="pseudonyme", how="left")

    df_irm = brut["irm"].drop(columns=["date_diagnostic"])
    df_irm = appliquer_tolerance_examen_initial(
        df_irm.merge(df[["pseudonyme", "date_diagnostic"]], on="pseudonyme", how="left"),
        col_date_examen="date_examen",
        colonnes_a_invalider=["nb_lesions_t2", "prise_contraste_gd"],
        tolerance_jours=TOLERANCE_IRM_JOURS,
    ).drop(columns=["date_examen", "date_diagnostic"])
    df = df.merge(df_irm, on="pseudonyme", how="left")

    df_lcr = brut["lcr"].drop(columns=["date_diagnostic"])
    df_lcr = appliquer_tolerance_examen_initial(
        df_lcr.merge(df[["pseudonyme", "date_diagnostic"]], on="pseudonyme", how="left"),
        col_date_examen="date_prelevement",
        colonnes_a_invalider=["bandes_oligoclonales", "index_igg"],
        tolerance_jours=TOLERANCE_LCR_JOURS,
    ).drop(columns=["date_prelevement", "date_diagnostic"])
    df = df.merge(df_lcr, on="pseudonyme", how="left")

    edss_baseline = deriver_edss_baseline(df, brut["edss"])
    df = df.merge(edss_baseline, on="pseudonyme", how="left")

    for h, col in HORIZONS_ENCADRANTE.items():
        edss_h = deriver_edss_a_horizon(df, brut["edss"], horizon_annees=h) \
            .rename(columns={"edss_valeur": col})
        df = df.merge(edss_h, on="pseudonyme", how="left")

    tap_precoce = agreger_tap(df, brut["tap"], horizon_annees=FENETRE_TAP_PRECOCE_ANNEES)
    df = df.merge(tap_precoce, on="pseudonyme", how="left")

    progression = detecter_progression_confirmee(df, brut["edss"], brut["suivi"])
    df = df.merge(progression, on="pseudonyme", how="left")

    return df

def etape_spearman(df, horizon_col):
    colonnes_requises = ["nb_lesions_t2", horizon_col]
    df_valide = filtrer_non_manquant(df, colonnes_requises)
    rapport_valeurs_manquantes(df, colonnes_requises)

    x = df_valide["nb_lesions_t2"]
    y = df_valide[horizon_col]
    rho, p = stats.spearmanr(x, y)

    print("=" * 70)
    print(f"ÉTAPE 1 (FIXE) — Corrélation de Spearman : nb_lesions_t2 vs {horizon_col}")
    print("=" * 70)
    print(f"  rho = {rho:.3f}   p-value = {p:.4g}   n = {len(df_valide)} "
          f"(sur {len(df)} patients au total, après exclusion NULL/'NA')")
    interpretation_spearman(rho, p)

    plt.figure(figsize=(6, 5))
    sns.regplot(x=x, y=y, lowess=True, scatter_kws={"alpha": 0.5},
                line_kws={"color": "red"})
    plt.xlabel("Nombre de lésions T2 au diagnostic")
    plt.ylabel(f"EDSS ({horizon_col})")
    plt.title(f"Spearman rho={rho:.2f}, p={p:.3g}")
    plt.tight_layout()
    plt.savefig(f"spearman_{horizon_col}.png", dpi=150)
    plt.show()

    return rho, p


def interpretation_spearman(rho, p):
    force = (
        "négligeable" if abs(rho) < 0.2 else
        "faible" if abs(rho) < 0.4 else
        "modérée" if abs(rho) < 0.6 else
        "forte"
    )
    signif = "statistiquement significative" if p < 0.05 else "non significative"
    print(f"  -> Interprétation : association {force} et {signif}.")
    print("     rho généralement compris")
    print("     entre 0.3 et 0.7 selon l'horizon. Un rho modéré n'est PAS un échec :")
    print("     c'est la 'dissociation clinico-radiologique' documentée.\n")


def regression_lineaire_simple(df, horizon_col):
    colonnes_requises = ["nb_lesions_t2", horizon_col]
    rapport_valeurs_manquantes(df, colonnes_requises)
    df_valide = filtrer_non_manquant(df, colonnes_requises)

    X = sm.add_constant(df_valide["nb_lesions_t2"])
    y = df_valide[horizon_col]
    modele = sm.OLS(y, X).fit()
    print("=" * 70)
    print(f"RÉGRESSION LINÉAIRE SIMPLE : {horizon_col} ~ nb_lesions_t2 (n={len(df_valide)})")
    print("=" * 70)
    print(modele.summary())
    interpretation_regression_lineaire(modele, "nb_lesions_t2")
    graphes_diagnostic_lineaire(modele, df_valide, horizon_col)
    return modele


def regression_lineaire_multiple(df, horizon_col, covariables):
    covariables_invalides = set(covariables) - set(COVARIABLES_AUTORISEES)
    if covariables_invalides:
        raise ValueError(
            f"Covariable(s) non autorisée(s) : {covariables_invalides}\n"
            f"Covariables autorisées (intersection registre x littérature) : "
            f"{COVARIABLES_AUTORISEES}"
        )

    predicteurs = list(dict.fromkeys(["nb_lesions_t2"] + list(covariables)))
    colonnes_requises = predicteurs + [horizon_col]
    rapport_valeurs_manquantes(df, colonnes_requises)
    df_valide = filtrer_non_manquant(df, colonnes_requises)

    df_enc = pd.get_dummies(df_valide[predicteurs], drop_first=True)
    X = sm.add_constant(df_enc.astype(float))
    y = df_valide[horizon_col]
    modele = sm.OLS(y, X).fit()

    print("=" * 70)
    print(f"RÉGRESSION LINÉAIRE MULTIPLE : {horizon_col} ~ nb_lesions_t2 + {covariables} "
          f"(n={len(df_valide)})")
    print("=" * 70)
    print(modele.summary())
    interpretation_regression_lineaire(modele, "nb_lesions_t2")
    graphes_diagnostic_lineaire(modele, df_valide, horizon_col)
    graphe_forest_coefficients(modele)
    return modele


def interpretation_regression_lineaire(modele, var_interet):
    coef = modele.params.get(var_interet, np.nan)
    p = modele.pvalues.get(var_interet, np.nan)
    r2 = modele.rsquared
    r2_adj = modele.rsquared_adj
    print(f"  -> Effet estimé de '{var_interet}' : +{coef:.3f} point d'EDSS par lésion T2")
    print(f"     supplémentaire (p={p:.4g}), toutes autres covariables égales par ailleurs.")
    print(f"     R² = {r2:.3f} (R² ajusté = {r2_adj:.3f}).")
    if r2 < 0.3:
        print("     R² faible : cohérent avec la littérature (dissociation")
        print("     clinico-radiologique) — ne pas surinterpréter.")
    print()


def graphes_diagnostic_lineaire(modele, df, horizon_col):
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    axes[0].scatter(modele.fittedvalues, modele.resid, alpha=0.5)
    axes[0].axhline(0, color="red", ls="--")
    axes[0].set_xlabel("Valeurs prédites")
    axes[0].set_ylabel("Résidus")
    axes[0].set_title("Résidus vs prédictions")

    sm.qqplot(modele.resid, line="45", fit=True, ax=axes[1])
    axes[1].set_title("QQ-plot des résidus")

    axes[2].scatter(df[horizon_col], modele.fittedvalues, alpha=0.5)
    lims = [min(df[horizon_col].min(), modele.fittedvalues.min()),
            max(df[horizon_col].max(), modele.fittedvalues.max())]
    axes[2].plot(lims, lims, "r--")
    axes[2].set_xlabel("EDSS observé")
    axes[2].set_ylabel("EDSS prédit")
    axes[2].set_title("Observé vs prédit")

    plt.tight_layout()
    plt.savefig(f"diagnostic_regression_{horizon_col}.png", dpi=150)
    plt.show()


def graphe_forest_coefficients(modele):
    conf = modele.conf_int()
    conf.columns = ["low", "high"]
    conf["coef"] = modele.params
    conf = conf.drop("const", errors="ignore")

    plt.figure(figsize=(6, 0.5 * len(conf) + 1))
    plt.errorbar(conf["coef"], conf.index,
                 xerr=[conf["coef"] - conf["low"], conf["high"] - conf["coef"]],
                 fmt="o", color="black", capsize=3)
    plt.axvline(0, color="red", ls="--")
    plt.xlabel("Coefficient (IC 95%)")
    plt.title("Forest plot des coefficients de régression")
    plt.tight_layout()
    plt.savefig("forest_plot_coefficients.png", dpi=150)
    plt.show()


def landmark_exclure_post_baseline(df_valide, covariables, fenetre_annees=FENETRE_TAP_PRECOCE_ANNEES):
    
    covariables_post_baseline = set(covariables) & COVARIABLES_POST_BASELINE_COX
    if not covariables_post_baseline:
        return df_valide

    avant = len(df_valide)
    masque = df_valide["temps_progression"] >= fenetre_annees
    df_landmark = df_valide.loc[masque].copy()
    n_exclus = avant - len(df_landmark)
    if n_exclus > 0:
        print(f"  {n_exclus} patient(s) exclu(s) : "
              f"événement/censure survenu avant la fin de la fenêtre "
              f"d'exposition de {covariables_post_baseline} ({fenetre_annees} an(s)), "
              f"pour éviter le biais de temps immortel. "
              f"{len(df_landmark)}/{avant} patients conservés pour ce modèle Cox.\n")
    return df_landmark


def regression_cox(df, covariables=None):
    covariables = covariables or []
    covariables_invalides = set(covariables) - set(COVARIABLES_AUTORISEES)
    if covariables_invalides:
        raise ValueError(f"Covariable(s) non autorisée(s) : {covariables_invalides}")

    predicteurs = list(dict.fromkeys(["nb_lesions_t2"] + list(covariables)))
    colonnes_requises = predicteurs + ["temps_progression", "evenement_progression"]
    rapport_valeurs_manquantes(df, colonnes_requises)
    df_valide = filtrer_non_manquant(df, colonnes_requises)

    df_valide = landmark_exclure_post_baseline(df_valide, covariables)

    df_cox = pd.get_dummies(df_valide[colonnes_requises], drop_first=True).astype(float)

    nb_evenements = int(df_valide["evenement_progression"].sum())
    nb_covariables_encodees = df_cox.shape[1] - 2
    ratio = nb_evenements / max(nb_covariables_encodees, 1)
    if ratio < 10:
        print(f"  ATTENTION : seulement {nb_evenements} événements observés pour "
              f"{nb_covariables_encodees} covariable(s) encodée(s) (ratio={ratio:.1f} "
              f"< 10 recommandé). Risque de surapprentissage : interpréter les "
              f"résultats avec prudence, envisager de réduire le nombre de "
              f"covariables.\n")

    cph = CoxPHFitter()
    cph.fit(df_cox, duration_col="temps_progression", event_col="evenement_progression")

    print("=" * 70)
    print(f"RÉGRESSION DE COX : progression EDSS ~ nb_lesions_t2 + {covariables} "
          f"(n={len(df_valide)})")
    print("=" * 70)
    cph.print_summary()
    interpretation_cox(cph)

    try:
        test_ph = proportional_hazard_test(cph, df_cox, time_transform="rank")
        print("\nTest de l'hypothèse des risques proportionnels (Schoenfeld) :")
        print(test_ph.summary)
        viol = test_ph.summary[test_ph.summary["p"] < 0.05]
        if len(viol):
            print("  ATTENTION : hypothèse des risques proportionnels possiblement")
            print("  violée pour :", list(viol.index), "-> interpréter les HR avec prudence.")
    except Exception as e:
        print(f"  (Test de proportionnalité non calculable : {e})")

    plt.figure(figsize=(6, 5))
    kmf = KaplanMeierFitter()
    mediane_t2 = df_valide["nb_lesions_t2"].median()
    groupe_haut = df_valide["nb_lesions_t2"] >= mediane_t2
    for label, mask in [(f"T2 ≥ {mediane_t2:.0f} (charge élevée)", groupe_haut),
                         (f"T2 < {mediane_t2:.0f} (charge faible)", ~groupe_haut)]:
        kmf.fit(df_valide.loc[mask, "temps_progression"],
                df_valide.loc[mask, "evenement_progression"], label=label)
        kmf.plot_survival_function()
    plt.title("Kaplan-Meier : probabilité de non-progression selon charge T2")
    plt.xlabel("Temps (années)")
    plt.ylabel("Probabilité de non-progression")
    plt.tight_layout()
    plt.savefig("kaplan_meier_t2.png", dpi=150)
    plt.show()

    cph.plot()
    plt.title("Hazard Ratios (IC 95%) - Régression de Cox")
    plt.tight_layout()
    plt.savefig("forest_plot_cox.png", dpi=150)
    plt.show()

    return cph


def interpretation_cox(cph):
    hr = cph.hazard_ratios_.get("nb_lesions_t2", np.nan)
    p = cph.summary.loc["nb_lesions_t2", "p"] if "nb_lesions_t2" in cph.summary.index else np.nan
    print(f"  -> Hazard Ratio (nb_lesions_t2) = {hr:.3f} (p={p:.4g})")
    if hr > 1:
        print(f"     Chaque lésion T2 supplémentaire au diagnostic multiplie par {hr:.2f}")
        print("     le risque instantané de progression confirmée du handicap.")
    print("     Avantage vs régression linéaire à horizon fixe : gère la censure")
    print("     (patients pas encore à 5 ans de suivi, perdus de vue).")
    print("     Limite : censure supposée non informative -- discutable pour les")
    print("     patients 'Perdus de vue'\n")



def graphes_descriptifs(df, horizon_col):
    colonnes_requises = ["nb_lesions_t2", horizon_col]
    df_valide = filtrer_non_manquant(df, colonnes_requises)
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    sns.histplot(df_valide["nb_lesions_t2"], kde=True, ax=axes[0])
    axes[0].set_title("Distribution du nombre de lésions T2 au diagnostic")
    sns.histplot(df_valide[horizon_col], kde=True, ax=axes[1])
    axes[1].set_title(f"Distribution de l'EDSS ({horizon_col})")
    plt.tight_layout()
    plt.savefig(f"descriptifs_{horizon_col}.png", dpi=150)
    plt.show()


def menu_interactif(df):
    print("\n=== TEST SEP #4 : Charge lésionnelle T2 et sévérité future (EDSS) ===\n")

    print("Horizons disponibles :")
    print("  [imposés par l'encadrante]  2 = EDSS à 2 ans | 5 = EDSS à 5 ans")
    horizon = int(input("Choix de l'horizon : ").strip())
    horizon_col = HORIZONS_ENCADRANTE.get(horizon)
    if horizon_col is None or horizon_col not in df.columns:
        raise ValueError("Horizon invalide ou colonne absente du registre.")

    graphes_descriptifs(df, horizon_col)
    etape_spearman(df, horizon_col)

    print("Type de régression :")
    print("  1 = Cox (temps jusqu'à progression confirmée)")
    print("  2 = Linéaire simple (nb_lesions_t2 seul)")
    print("  3 = Linéaire multiple (+ covariables au choix)")
    choix = input("Votre choix (1/2/3) : ").strip()

    if choix == "1":
        print(f"\nCovariables autorisées (intersection registre x littérature) : {COVARIABLES_AUTORISEES}")
        cov_input = input("Covariables à inclure (séparées par des virgules, ou vide) : ").strip()
        covariables = [c.strip() for c in cov_input.split(",") if c.strip()]
        regression_cox(df, covariables)

    elif choix == "2":
        regression_lineaire_simple(df, horizon_col)

    elif choix == "3":
        print(f"\nCovariables autorisées (intersection registre x littérature) : {COVARIABLES_AUTORISEES}")
        cov_input = input("Covariables à inclure (séparées par des virgules) : ").strip()
        covariables = [c.strip() for c in cov_input.split(",") if c.strip()]
        regression_lineaire_multiple(df, horizon_col, covariables)

    else:
        raise ValueError("Choix de régression invalide.")


if __name__ == "__main__":
    engine = get_engine()
    df_registre = construire_dataframe_analyse(engine)
    menu_interactif(df_registre)



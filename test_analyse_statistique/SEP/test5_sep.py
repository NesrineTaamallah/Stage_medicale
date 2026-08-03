import os
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf
from lifelines import CoxPHFitter, KaplanMeierFitter
from lifelines.statistics import multivariate_logrank_test
import matplotlib.pyplot as plt

pd.set_option("display.width", 120)


CONFIG = {
    "count_model": "auto",
    "horizons_years": [1, 2, 5],
    "igg_threshold": 0.7,
    "multiple_testing_correction": "bonferroni",
}


DB_CONFIG = {
    "host": os.environ.get("SEP_DB_HOST", "localhost"),
    "port": os.environ.get("SEP_DB_PORT", "5432"),
    "dbname": os.environ.get("SEP_DB_NAME", "registre_sep"),
    "user": os.environ.get("SEP_DB_USER", "postgres"),
    "password": os.environ.get("SEP_DB_PASSWORD", ""),
}

DOSSIER_GRAPHES = os.environ.get("SEP_DOSSIER_GRAPHES", "graphes_sortie")

REQUIRED_COLUMNS = [
    "patient_id", "boc_positive", "igg_index",
    "nb_poussees", "duree_suivi_annees",
    "temps_evenement_annees", "evenement_survenu",
]


SQL_EXTRACTION = """
WITH lcr_diagnostic AS (
    SELECT DISTINCT ON (pseudonyme)
        pseudonyme,
        bandes_oligoclonales,
        index_igg,
        date_prelevement AS date_index
    FROM sep_biologie_lcr
    WHERE bandes_oligoclonales IS NOT NULL
      AND bandes_oligoclonales != 'NA'
      AND index_igg IS NOT NULL
    ORDER BY pseudonyme, date_prelevement ASC
),
poussees_agg AS (
    SELECT
        pseudonyme,
        ARRAY_AGG(date_poussee ORDER BY date_poussee) AS dates_poussees
    FROM sep_poussees
    GROUP BY pseudonyme
)
SELECT
    l.pseudonyme                      AS patient_id,
    l.bandes_oligoclonales,
    l.index_igg,
    l.date_index,
    p.dates_poussees,
    (p.pseudonyme IS NOT NULL)        AS a_des_poussees_documentees,
    e.forme_evolutive,
    e.date_conversion_sp,
    s.date_dernier_suivi,
    s.statut_dernier_suivi
FROM lcr_diagnostic l
LEFT JOIN poussees_agg p ON p.pseudonyme = l.pseudonyme
LEFT JOIN sep_evolution e ON e.pseudonyme = l.pseudonyme
LEFT JOIN sep_suivi s ON s.pseudonyme = l.pseudonyme
WHERE s.date_dernier_suivi IS NOT NULL;
"""


def creer_connexion_postgres(db_config=None):
    
    from sqlalchemy import create_engine

    cfg = db_config or DB_CONFIG
    url = (
        f"postgresql+psycopg2://{cfg['user']}:{cfg['password']}"
        f"@{cfg['host']}:{cfg['port']}/{cfg['dbname']}"
    )
    try:
        engine = create_engine(url)
        with engine.connect() as conn:
            pass  
        return engine
    except Exception as e:
        raise ConnectionError(
            f"Impossible de se connecter à Postgres ({cfg['host']}:{cfg['port']}/"
            f"{cfg['dbname']}). Vérifie que le serveur tourne et que les "
            f"identifiants (variables SEP_DB_*) sont corrects.\nErreur : {e}"
        )


def extraire_depuis_postgres(engine):
    df_brut = pd.read_sql(SQL_EXTRACTION, engine)

    def _to_dates_or_none(x):
        if isinstance(x, (list, tuple)):
            return pd.to_datetime(list(x))
        return None 

    df_brut["dates_poussees"] = df_brut["dates_poussees"].apply(_to_dates_or_none)

    for col in ["date_index", "date_conversion_sp", "date_dernier_suivi"]:
        df_brut[col] = pd.to_datetime(df_brut[col])
    return df_brut


def recoder_variables_brutes(df_brut):
    df = df_brut.copy()

    def _normaliser_boc(val):
        if pd.isna(val):
            return val
        v = str(val).strip().lower()
        v = (
            v.replace("é", "e")
            .replace("è", "e")
            .replace("ê", "e")
        )
        if v == "positif":
            return "Positif"
        if v == "negatif":
            return "Négatif"
        return val

    df["bandes_oligoclonales_norm"] = df["bandes_oligoclonales"].apply(_normaliser_boc)

    mapping_boc = {"Positif": 1, "Négatif": 0}
    df["boc_positive"] = df["bandes_oligoclonales_norm"].map(mapping_boc)

    masque_non_mappe = df["boc_positive"].isna() & df["bandes_oligoclonales_norm"].notna()
    if masque_non_mappe.any():
        valeurs_inattendues = df.loc[masque_non_mappe, "bandes_oligoclonales"].unique()
        raise ValueError(
            f"Valeurs inattendues dans bandes_oligoclonales : {valeurs_inattendues} "
            "(attendu : 'Positif' / 'Négatif' [variantes casse/accents/espaces tolérées], "
            "ou NULL si non renseigné)"
        )
    df["igg_index"] = df["index_igg"]
    return df


def filtrer_valeurs_manquantes(df, colonnes, contexte=""):
    n_avant = len(df)
    masque_complet = df[colonnes].notna().all(axis=1)
    df_filtre = df.loc[masque_complet].copy()
    n_exclus = n_avant - len(df_filtre)
    if n_exclus > 0:
        print(
            f"[valeurs manquantes]{' ' + contexte if contexte else ''} : "
            f"{n_exclus}/{n_avant} patient(s) exclu(s) pour NaN dans {colonnes}"
        )
    return df_filtre


def valider_schema(df, colonnes=REQUIRED_COLUMNS, contexte=""):
    manquantes = [c for c in colonnes if c not in df.columns]
    if manquantes:
        raise ValueError(
            f"Schéma invalide{' (' + contexte + ')' if contexte else ''} : "
            f"colonnes manquantes {manquantes}"
        )
    return df


def simulate_demo_dataset(n=120, seed=42):
    rng = np.random.default_rng(seed)
    boc_positive = rng.binomial(1, 0.85, size=n)
    igg_index = np.clip(rng.normal(0.75, 0.25, size=n) + 0.15 * boc_positive, 0.2, 1.8)
    duree_suivi = rng.uniform(1, 6, size=n)

    lam = 0.4 + 0.3 * boc_positive + 0.2 * (igg_index > 0.7)
    nb_poussees = rng.negative_binomial(n=2, p=2 / (2 + lam * duree_suivi))

    hazard_mult = np.exp(0.5 * boc_positive + 0.3 * (igg_index - 0.7))
    temps_evenement = rng.exponential(scale=3 / hazard_mult)
    evenement_survenu = (temps_evenement <= duree_suivi).astype(int)
    temps_evenement = np.minimum(temps_evenement, duree_suivi)

    return pd.DataFrame({
        "patient_id": np.arange(1, n + 1),
        "boc_positive": boc_positive,
        "igg_index": igg_index,
        "nb_poussees": nb_poussees,
        "duree_suivi_annees": duree_suivi,
        "temps_evenement_annees": temps_evenement,
        "evenement_survenu": evenement_survenu,
        "forme_evolutive": rng.choice(
            ["RR", "SP", "progressive d'emblée"], size=n, p=[0.75, 0.15, 0.10]
        ),
        "statut_dernier_suivi": rng.choice(
            ["Stable", "Perdu de vue", "Décédé"], size=n, p=[0.85, 0.10, 0.05]
        ),
        "a_des_poussees_documentees": True,
    })


def deriver_variables_survie(df_brut, definition_evenement="conversion_sp"):
    df = df_brut.copy()

    if definition_evenement == "conversion_sp":
        est_sp = df["forme_evolutive"].eq("SP")
        forme_non_renseignee = df["forme_evolutive"].isna()
        date_manquante = df["date_conversion_sp"].isna()

        donnee_manquante = date_manquante & (est_sp | forme_non_renseignee)
        if donnee_manquante.any():
            n_sp = int((date_manquante & est_sp).sum())
            n_forme_nulle = int((date_manquante & forme_non_renseignee).sum())
            print(
                f"[valeurs manquantes] conversion_sp : {donnee_manquante.sum()} "
                f"patient(s) exclu(s) — {n_sp} avec forme_evolutive='SP' sans date, "
                f"{n_forme_nulle} avec forme_evolutive non renseignée"
            )
        df = df.loc[~donnee_manquante].copy()

        masque_prog_emblee = df["forme_evolutive"].eq("progressive d'emblée")
        if masque_prog_emblee.any():
            print(
                f"[hors périmètre] conversion_sp : {masque_prog_emblee.sum()} "
                "patient(s) 'progressive d'emblée' exclu(s) — jamais à risque "
                "de conversion RR->SP par définition"
            )
        df = df.loc[~masque_prog_emblee].copy()

        evenement = df["date_conversion_sp"].notna().astype(int)
        date_fin = df["date_conversion_sp"].fillna(df["date_dernier_suivi"])

    elif definition_evenement == "poussee_suivante":
        if "a_des_poussees_documentees" in df.columns:
            sans_saisie = ~df["a_des_poussees_documentees"].astype(bool)
        else:
            sans_saisie = df["dates_poussees"].isna()
        if sans_saisie.any():
            print(
                f"[valeurs manquantes] poussee_suivante : {int(sans_saisie.sum())} "
                "patient(s) exclu(s) — absence de saisie dans sep_poussees "
                "(PAS 'pas de poussée future')"
            )
        df = df.loc[~sans_saisie].copy()

        def premiere_poussee_apres_index(row):
            if row["dates_poussees"] is None:
                return pd.NaT
            dates_futures = [d for d in row["dates_poussees"] if d > row["date_index"]]
            return min(dates_futures) if dates_futures else pd.NaT

        date_evenement = df.apply(premiere_poussee_apres_index, axis=1)
        evenement = date_evenement.notna().astype(int)
        date_fin = date_evenement.fillna(df["date_dernier_suivi"])

    else:
        raise ValueError("definition_evenement doit être 'conversion_sp' ou 'poussee_suivante'")

    df["temps_evenement_annees"] = (date_fin - df["date_index"]).dt.days / 365.25
    df["evenement_survenu"] = evenement

    masque_negatif = df["temps_evenement_annees"] < 0
    if masque_negatif.any():
        print(
            f"[incohérence dates] {masque_negatif.sum()} patient(s) avec "
            "temps_evenement_annees négatif (date d'évènement antérieure à "
            "date_index) — exclus, à vérifier en base"
        )
        df = df.loc[~masque_negatif].copy()

    if "statut_dernier_suivi" in df.columns:
        censures = df["evenement_survenu"] == 0
        deces_censures = censures & df["statut_dernier_suivi"].eq("Décédé")
        if deces_censures.any():
            print(
                f"[censure informative ?] {int(deces_censures.sum())} patient(s) "
                "censuré(s) suite à un DÉCÈS plutôt qu'une fin de suivi stable/"
                "perdu de vue — hypothèse de censure non-informative du Cox à "
                "vérifier ; flag 'censure_par_deces' ajouté pour analyse de "
                "sensibilité (ex. exclusion ou compétition de risques)"
            )
        df["censure_par_deces"] = deces_censures

    return df


def deriver_variables_tap(df_brut):
    df = df_brut.copy()

    if "a_des_poussees_documentees" in df.columns:
        sans_saisie = ~df["a_des_poussees_documentees"].astype(bool)
        if sans_saisie.any():
            print(
                f"[valeurs manquantes] nb_poussees : {int(sans_saisie.sum())} "
                "patient(s) sans aucune ligne dans sep_poussees (absence de "
                "saisie, PAS '0 poussée confirmée') — nb_poussees mis à NaN "
                "pour exclusion explicite des analyses TAP"
            )

    def _compter_poussees(row):
        if row.get("a_des_poussees_documentees", True) is False or row["dates_poussees"] is None:
            return np.nan
        return sum(1 for d in row["dates_poussees"] if d > row["date_index"])

    df["nb_poussees"] = df.apply(_compter_poussees, axis=1)
    df["duree_suivi_annees"] = (df["date_dernier_suivi"] - df["date_index"]).dt.days / 365.25

    masque_duree_nulle = df["duree_suivi_annees"] <= 0
    if masque_duree_nulle.any():
        print(
            f"[durée nulle] {int(masque_duree_nulle.sum())} patient(s) avec "
            "duree_suivi_annees <= 0 (date_dernier_suivi == date_index ou "
            "antérieure) — exclus des analyses TAP (division par zéro / "
            "log(0) sinon)"
        )
        df.loc[masque_duree_nulle, "duree_suivi_annees"] = np.nan
        df.loc[masque_duree_nulle, "nb_poussees"] = np.nan

    return df


def prepare_variables(df, igg_threshold):
    df = df.copy()
    df["tap"] = df["nb_poussees"] / df["duree_suivi_annees"]
    df["tap"] = df["tap"].replace([np.inf, -np.inf], np.nan)
    df["igg_positive"] = (df["igg_index"] > igg_threshold).astype(int)
    return df


def mann_whitney_tap(df, group_col):
    df = filtrer_valeurs_manquantes(df, [group_col, "tap"], contexte=f"Mann-Whitney ({group_col})")
    g1 = df.loc[df[group_col] == 1, "tap"]
    g0 = df.loc[df[group_col] == 0, "tap"]
    stat, p = stats.mannwhitneyu(g1, g0, alternative="two-sided")
    return {
        "comparaison": group_col,
        "n_positif": len(g1), "n_negatif": len(g0),
        "mediane_TAP_positif": g1.median(), "mediane_TAP_negatif": g0.median(),
        "U": stat, "p_value": p,
    }


def test_surdispersion(df):
    df = filtrer_valeurs_manquantes(
        df, ["nb_poussees", "boc_positive", "igg_index", "duree_suivi_annees"],
        contexte="GLM Poisson (surdispersion)",
    )
    df = df.loc[df["duree_suivi_annees"] > 0].copy()
    model = smf.glm(
        "nb_poussees ~ boc_positive + igg_index",
        data=df,
        family=sm.families.Poisson(),
        offset=np.log(df["duree_suivi_annees"]),
    ).fit()
    dispersion_ratio = model.pearson_chi2 / model.df_resid
    return dispersion_ratio, model


def count_model_tap(df, method="auto"):
    df = filtrer_valeurs_manquantes(
        df, ["nb_poussees", "boc_positive", "igg_index", "duree_suivi_annees"],
        contexte="modèle de comptage TAP",
    )
    df = df.loc[df["duree_suivi_annees"] > 0].copy()
    dispersion_ratio, poisson_model = test_surdispersion(df)

    chosen = method
    if method == "auto":
        chosen = "negbin" if dispersion_ratio > 1.5 else "poisson"

    if chosen == "poisson":
        final_model = poisson_model
        params, conf_int, pvalues = final_model.params, final_model.conf_int(), final_model.pvalues
    else:
        import statsmodels.discrete.discrete_model as dm
        X = sm.add_constant(df[["boc_positive", "igg_index"]])
        nb_model = dm.NegativeBinomial(
            df["nb_poussees"], X, exposure=df["duree_suivi_annees"], loglike_method="nb2"
        ).fit(disp=0)
        final_model = nb_model
        params = nb_model.params.drop("alpha", errors="ignore")
        conf_int_full = nb_model.conf_int()
        conf_int = conf_int_full.drop("alpha", errors="ignore")
        pvalues = nb_model.pvalues.drop("alpha", errors="ignore")

    summary = pd.DataFrame({
        "coef": params,
        "rate_ratio": np.exp(params),
        "IC95_bas": np.exp(conf_int[0]),
        "IC95_haut": np.exp(conf_int[1]),
        "p_value": pvalues,
    })

    return {
        "modele_choisi": chosen,
        "ratio_dispersion_pearson": dispersion_ratio,
        "resume": summary,
        "model_obj": final_model,
    }


def cox_par_horizon(df, horizons_years):
    df = filtrer_valeurs_manquantes(
        df, ["temps_evenement_annees", "evenement_survenu", "boc_positive", "igg_index"],
        contexte="Cox par horizon",
    )
    masque_negatif = df["temps_evenement_annees"] < 0
    if masque_negatif.any():
        print(
            f"[incohérence dates] Cox : {int(masque_negatif.sum())} patient(s) "
            "avec temps_evenement_annees négatif — exclus"
        )
        df = df.loc[~masque_negatif].copy()

    resultats = []
    for h in horizons_years:
        sub = df.copy()
        sub["temps_horizon"] = np.minimum(sub["temps_evenement_annees"], h)
        sub["evenement_horizon"] = np.where(
            sub["temps_evenement_annees"] <= h, sub["evenement_survenu"], 0
        )

        cph = CoxPHFitter()
        cph.fit(
            sub[["temps_horizon", "evenement_horizon", "boc_positive", "igg_index"]],
            duration_col="temps_horizon",
            event_col="evenement_horizon",
        )
        s = cph.summary
        resultats.append({
            "horizon_annees": h,
            "HR_boc_positive": np.exp(s.loc["boc_positive", "coef"]),
            "p_boc_positive": s.loc["boc_positive", "p"],
            "HR_igg_index": np.exp(s.loc["igg_index", "coef"]),
            "p_igg_index": s.loc["igg_index", "p"],
            "n_evenements": int(sub["evenement_horizon"].sum()),
        })
    return pd.DataFrame(resultats)


def appliquer_bonferroni(p_values):
    n = len(p_values)
    return [min(p * n, 1.0) for p in p_values]


def plot_mann_whitney(df, group_col, ax=None):
    df_valide = filtrer_valeurs_manquantes(df, [group_col, "tap"], contexte=f"plot ({group_col})")
    data = [
        df_valide.loc[df_valide[group_col] == 0, "tap"].dropna(),
        df_valide.loc[df_valide[group_col] == 1, "tap"].dropna(),
    ]
    if ax is None:
        fig, ax = plt.subplots(figsize=(5, 4))
    ax.boxplot(data, tick_labels=["Négatif", "Positif"], showmeans=True)
    ax.set_ylabel("TAP (poussées/an)")
    ax.set_title(f"TAP selon {group_col}")
    return ax


def plot_count_model(count_res, ax=None):
    resume = count_res["resume"].drop("const", errors="ignore")
    if ax is None:
        fig, ax = plt.subplots(figsize=(5, 4))
    y_pos = np.arange(len(resume))
    ax.errorbar(
        resume["rate_ratio"], y_pos,
        xerr=[resume["rate_ratio"] - resume["IC95_bas"], resume["IC95_haut"] - resume["rate_ratio"]],
        fmt="o", capsize=4,
    )
    ax.axvline(1, color="grey", linestyle="--")
    ax.set_yticks(y_pos)
    ax.set_yticklabels(resume.index)
    ax.set_xlabel("Rate ratio (IC95%)")
    ax.set_title(f"Modèle de comptage ({count_res['modele_choisi'].upper()})")
    return ax


def plot_cox_horizon(cox_res, ax=None):
    if ax is None:
        fig, ax = plt.subplots(figsize=(5, 4))
    ax.plot(cox_res["horizon_annees"], cox_res["HR_boc_positive"], marker="o", label="HR BOC positif")
    ax.plot(cox_res["horizon_annees"], cox_res["HR_igg_index"], marker="s", label="HR IgG index")
    ax.axhline(1, color="grey", linestyle="--")
    ax.set_xlabel("Horizon (années)")
    ax.set_ylabel("Hazard ratio")
    ax.set_title("Cox par horizon temporel")
    ax.legend()
    return ax


def plot_km(df, group_col, ax=None):
    df_valide = filtrer_valeurs_manquantes(
        df, ["temps_evenement_annees", "evenement_survenu", group_col],
        contexte=f"KM ({group_col})",
    )
    if ax is None:
        fig, ax = plt.subplots(figsize=(5, 4))
    kmf = KaplanMeierFitter()
    for val, label in [(0, "Négatif"), (1, "Positif")]:
        sub = df_valide.loc[df_valide[group_col] == val]
        kmf.fit(sub["temps_evenement_annees"], sub["evenement_survenu"], label=label)
        kmf.plot_survival_function(ax=ax)
    ax.set_xlabel("Temps (années)")
    ax.set_ylabel("Survie sans évènement")
    ax.set_title(f"Kaplan-Meier selon {group_col}")
    return ax


GRAPHES_DISPONIBLES = {
    "mann_whitney_boc": lambda df, results: plot_mann_whitney(df, "boc_positive"),
    "mann_whitney_igg": lambda df, results: plot_mann_whitney(df, "igg_positive"),
    "count_model": lambda df, results: plot_count_model(results["count_model"]),
    "cox_horizon": lambda df, results: plot_cox_horizon(results["cox_par_horizon"]),
    "km_boc": lambda df, results: plot_km(df, "boc_positive"),
}


def generer_graphes(df, results, choix=None, afficher=True, dossier_sortie=None):
    
    noms = choix if choix is not None else list(GRAPHES_DISPONIBLES.keys())
    inconnus = [n for n in noms if n not in GRAPHES_DISPONIBLES]
    if inconnus:
        raise ValueError(
            f"Graphe(s) inconnu(s) : {inconnus}. "
            f"Disponibles : {list(GRAPHES_DISPONIBLES.keys())}"
        )

    axes_generes = {}
    for nom in noms:
        ax = GRAPHES_DISPONIBLES[nom](df, results)
        ax.figure.tight_layout()
        if dossier_sortie:
            os.makedirs(dossier_sortie, exist_ok=True)
            ax.figure.savefig(os.path.join(dossier_sortie, f"{nom}.png"), dpi=150)
        axes_generes[nom] = ax

    if afficher:
        plt.show()

    return axes_generes


def run_full_analysis(df, config=CONFIG):
    df = prepare_variables(df, config["igg_threshold"])
    valider_schema(df, contexte="run_full_analysis")

    print("=" * 80)
    print("1) MANN-WHITNEY — TAP selon statut BOC et statut IgG")
    print("=" * 80)
    mw_boc = mann_whitney_tap(df, "boc_positive")
    mw_igg = mann_whitney_tap(df, "igg_positive")
    mw_results = pd.DataFrame([mw_boc, mw_igg])
    print(mw_results.to_string(index=False))

    print("\n" + "=" * 80)
    print("2) MODÈLE DE COMPTAGE POUR LE TAP (choix : %s)" % config["count_model"])
    print("=" * 80)
    count_res = count_model_tap(df, method=config["count_model"])
    print(f"Ratio de dispersion Pearson (>1.5 => surdispersion) : "
          f"{count_res['ratio_dispersion_pearson']:.2f}")
    print(f"Modèle retenu : {count_res['modele_choisi'].upper()}")
    print(count_res["resume"].round(4).to_string())

    print("\n" + "=" * 80)
    print("3) RÉGRESSION DE COX PAR HORIZON TEMPOREL : %s ans"
          % config["horizons_years"])
    print("=" * 80)
    cox_res = cox_par_horizon(df, config["horizons_years"])
    print(cox_res.round(4).to_string(index=False))

    if config["multiple_testing_correction"] == "bonferroni":
        print("\n" + "=" * 80)
        print("4) CORRECTION BONFERRONI (sur les p-values BOC des %d horizons)"
              % len(config["horizons_years"]))
        print("=" * 80)
        p_corr = appliquer_bonferroni(cox_res["p_boc_positive"].tolist())
        cox_res["p_boc_positive_bonferroni"] = p_corr
        print(cox_res[["horizon_annees", "p_boc_positive",
                        "p_boc_positive_bonferroni"]].round(4).to_string(index=False))

    return {
        "mann_whitney": mw_results,
        "count_model": count_res,
        "cox_par_horizon": cox_res,
    }


if __name__ == "__main__":
    print(f"[source] Connexion à Postgres ({DB_CONFIG['host']}:"
          f"{DB_CONFIG['port']}/{DB_CONFIG['dbname']})...")
    engine = creer_connexion_postgres(DB_CONFIG)
    df_brut = extraire_depuis_postgres(engine)
    df_brut = recoder_variables_brutes(df_brut)
    df_brut = deriver_variables_survie(df_brut, definition_evenement="conversion_sp")
    df_brut = deriver_variables_tap(df_brut)
    valider_schema(df_brut, contexte="pipeline réel (Postgres)")
    df_analyse = df_brut

    results = run_full_analysis(df_analyse, CONFIG)

    
    df_prepare = prepare_variables(df_analyse, CONFIG["igg_threshold"])
    generer_graphes(
        df_prepare, results,
        choix=["mann_whitney_boc", "mann_whitney_igg", "count_model", "cox_horizon", "km_boc"],
        afficher=True,
        dossier_sortie=DOSSIER_GRAPHES,
    )
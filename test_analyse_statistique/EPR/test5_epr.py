
import os
import sys
import warnings
from contextlib import redirect_stdout
from io import StringIO

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests

import matplotlib
matplotlib.use("Agg")  
import matplotlib.pyplot as plt
import seaborn as sns

warnings.filterwarnings("ignore")
pd.set_option("display.width", 140)
pd.set_option("display.max_columns", 20)


MODE_DONNEES = os.environ.get("MODE_DONNEES", "sql")

DOSSIER_CSV = os.environ.get("DOSSIER_CSV", "./data_csv")
DOSSIER_SORTIE = "resultats_genotype_phenotype"
DOSSIER_FIGURES = os.path.join(DOSSIER_SORTIE, "figures")
os.makedirs(DOSSIER_FIGURES, exist_ok=True)

sns.set_theme(style="whitegrid", palette="Set2")

DB_URI = "postgresql+psycopg2://USER:PASSWORD@HOST:5432/neuroexo_predict"


def get_engine():
    from sqlalchemy import create_engine
    return create_engine(DB_URI)


CLASSES_ACMG_CAUSALES = ["Classe IV", "Classe V"]

ORDRE_SEVERITE_ACMG = {"Classe V": 1, "Classe IV": 2}


N_MIN_SOUS_GROUPE = 5

GRILLE_N_MIN_SENSIBILITE = [3, 5, 8, 10]

ALPHA = 0.05


def extraire_gene_par_patient_sql(conn) -> pd.DataFrame:
    
    from sqlalchemy import text
    query = text("""
        SELECT DISTINCT ON (pseudonyme)
            pseudonyme,
            gene_teste,
            variant_identifie,
            classification_acmg,
            mode_transmission
        FROM epr_genetique
        WHERE gene_teste IS NOT NULL
          AND gene_teste != 'NA'
          AND classification_acmg = ANY(:classes)
        ORDER BY pseudonyme,
            CASE classification_acmg
                WHEN 'Classe V' THEN 1
                WHEN 'Classe IV' THEN 2
            END,
            id ASC
    """)
    return pd.read_sql(query, conn, params={"classes": CLASSES_ACMG_CAUSALES})


def extraire_type_crise_dominant_sql(conn) -> pd.DataFrame:
    from sqlalchemy import text
    query = text("""
        SELECT DISTINCT ON (pseudonyme)
            pseudonyme,
            type_crise_ilae2017,
            sous_type,
            date_observation
        FROM epr_type_crise
        WHERE type_crise_ilae2017 IS NOT NULL
          AND type_crise_ilae2017 != 'NA'
        ORDER BY pseudonyme, date_observation DESC
    """)
    return pd.read_sql(query, conn)


def extraire_frequence_crises_sql(conn) -> pd.DataFrame:
    from sqlalchemy import text
    query = text("""
        SELECT
            pseudonyme,
            AVG(frequence_normalisee_mois) AS frequence_moyenne_mois,
            COUNT(*) AS nb_rapports_frequence
        FROM epr_frequence_crises
        WHERE frequence_normalisee_mois IS NOT NULL
        GROUP BY pseudonyme
    """)
    return pd.read_sql(query, conn)


def extraire_age_debut_sql(conn) -> pd.DataFrame:
    from sqlalchemy import text
    query = text("""
        SELECT pseudonyme, age_debut_crises_mois
        FROM epr_identification_clinique
        WHERE age_debut_crises_mois IS NOT NULL
    """)
    return pd.read_sql(query, conn)


def extraire_pharmacoresistance_sql(conn) -> pd.DataFrame:
    from sqlalchemy import text
    query = text("""
        SELECT
            pseudonyme,
            statut_declare,
            nb_echecs_inefficacite,
            nb_ae_total,
            statut_calcule_ilae
        FROM analytics.v_epr_pharmacoresistance_detail
    """)
    return pd.read_sql(query, conn)


def construire_dataset_sql(engine) -> pd.DataFrame:
    with engine.connect() as conn:
        df_gene = extraire_gene_par_patient_sql(conn)
        df_crise = extraire_type_crise_dominant_sql(conn)
        df_freq = extraire_frequence_crises_sql(conn)
        df_age = extraire_age_debut_sql(conn)
        df_pharm = extraire_pharmacoresistance_sql(conn)
    return _fusionner(df_gene, df_crise, df_freq, df_age, df_pharm)


def choisir_gene_representatif(df_genetique: pd.DataFrame) -> pd.DataFrame:
    
    df = df_genetique.copy()

    df = df[df["gene_teste"].notna() & (df["gene_teste"] != "NA")]
    df = df[df["classification_acmg"].isin(CLASSES_ACMG_CAUSALES)]

    df["_rang_severite"] = df["classification_acmg"].map(ORDRE_SEVERITE_ACMG)

    if "id" not in df.columns:
        raise ValueError(
            "La colonne 'id' est requise dans epr_genetique.csv pour appliquer "
            "la règle H2 (départage à sévérité ACMG égale par ordre d'ancienneté)."
        )

    df = df.sort_values(by=["pseudonyme", "_rang_severite", "id"], ascending=[True, True, True])
    df_representatif = df.groupby("pseudonyme", as_index=False).first()

    colonnes = ["pseudonyme", "gene_teste", "variant_identifie",
                "classification_acmg", "mode_transmission"]
    colonnes = [c for c in colonnes if c in df_representatif.columns]
    return df_representatif[colonnes]


def extraire_type_crise_dominant_csv(df_type_crise: pd.DataFrame) -> pd.DataFrame:
    df = df_type_crise.copy()
    df = df[df["type_crise_ilae2017"].notna() & (df["type_crise_ilae2017"] != "NA")]
    df["date_observation"] = pd.to_datetime(df["date_observation"])
    df = df.sort_values(by=["pseudonyme", "date_observation"], ascending=[True, False])
    return df.groupby("pseudonyme", as_index=False).first()[
        ["pseudonyme", "type_crise_ilae2017", "sous_type", "date_observation"]
    ]


def extraire_frequence_crises_csv(df_freq: pd.DataFrame) -> pd.DataFrame:
    df = df_freq.copy()
    df = df[df["frequence_normalisee_mois"].notna()]
    agg = df.groupby("pseudonyme").agg(
        frequence_moyenne_mois=("frequence_normalisee_mois", "mean"),
        nb_rapports_frequence=("frequence_normalisee_mois", "count"),
    ).reset_index()
    return agg


def extraire_age_debut_csv(df_clinique: pd.DataFrame) -> pd.DataFrame:
    df = df_clinique.copy()
    return df[df["age_debut_crises_mois"].notna()][["pseudonyme", "age_debut_crises_mois"]]


def extraire_pharmacoresistance_csv(df_pharm: pd.DataFrame) -> pd.DataFrame:
    colonnes = ["pseudonyme", "statut_declare", "nb_echecs_inefficacite",
                "nb_ae_total", "statut_calcule_ilae"]
    colonnes = [c for c in colonnes if c in df_pharm.columns]
    return df_pharm[colonnes]


def construire_dataset_csv(dossier: str) -> pd.DataFrame:
    def _lire(nom_fichier):
        chemin = os.path.join(dossier, nom_fichier)
        if not os.path.exists(chemin):
            raise FileNotFoundError(f"Fichier CSV attendu introuvable : {chemin}")
        return pd.read_csv(chemin)

    df_genetique_brut = _lire("epr_genetique.csv")
    df_crise_brut = _lire("epr_type_crise.csv")
    df_freq_brut = _lire("epr_frequence_crises.csv")
    df_clinique_brut = _lire("epr_identification_clinique.csv")
    df_pharm_brut = _lire("v_epr_pharmacoresistance_detail.csv")

    df_gene = choisir_gene_representatif(df_genetique_brut)          
    df_crise = extraire_type_crise_dominant_csv(df_crise_brut)
    df_freq = extraire_frequence_crises_csv(df_freq_brut)
    df_age = extraire_age_debut_csv(df_clinique_brut)
    df_pharm = extraire_pharmacoresistance_csv(df_pharm_brut)

    return _fusionner(df_gene, df_crise, df_freq, df_age, df_pharm)


def _fusionner(df_gene, df_crise, df_freq, df_age, df_pharm) -> pd.DataFrame:
    return (
        df_gene
        .merge(df_crise, on="pseudonyme", how="left")
        .merge(df_freq, on="pseudonyme", how="left")
        .merge(df_age, on="pseudonyme", how="left")
        .merge(df_pharm, on="pseudonyme", how="left")
    )


def construire_dataset() -> pd.DataFrame:
    if MODE_DONNEES == "sql":
        return construire_dataset_sql(get_engine())
    elif MODE_DONNEES == "csv":
        return construire_dataset_csv(DOSSIER_CSV)
    else:
        raise ValueError(f"MODE_DONNEES invalide : {MODE_DONNEES!r} (attendu 'sql' ou 'csv')")



def filtrer_sous_groupes_valides(df: pd.DataFrame, col_gene: str = "gene_teste",
                                  n_min: int = None, verbeux: bool = True) -> pd.DataFrame:
    n_min = N_MIN_SOUS_GROUPE if n_min is None else n_min
    effectifs = df[col_gene].value_counts()
    genes_valides = effectifs[effectifs >= n_min].index
    n_exclus = (~df[col_gene].isin(genes_valides)).sum()
    if n_exclus > 0 and verbeux:
        print(f"[INFO] {n_exclus} patients exclus des comparaisons par gène "
              f"(sous-groupe < {n_min} patients). "
              f"Gènes exclus : {sorted(set(effectifs[effectifs < n_min].index))}")
    return df[df[col_gene].isin(genes_valides)].copy()


def mediane_iqr(serie: pd.Series) -> str:
    serie = serie.dropna()
    if len(serie) == 0:
        return "NA"
    q1, med, q3 = np.nanpercentile(serie, [25, 50, 75])
    return f"{med:.1f} [{q1:.1f}-{q3:.1f}]"


def construire_table1_descriptive(df: pd.DataFrame, col_gene: str,
                                   vars_continues: list, vars_categorielles: list) -> pd.DataFrame:
    
    lignes = []
    genes = sorted(df[col_gene].dropna().unique())

    lignes.append({"Variable": "N patients", **{g: (df[col_gene] == g).sum() for g in genes},
                    "Ensemble": len(df)})

    for var in vars_continues:
        ligne = {"Variable": f"{var}, médiane [Q1-Q3]"}
        for g in genes:
            ligne[g] = mediane_iqr(df.loc[df[col_gene] == g, var])
        ligne["Ensemble"] = mediane_iqr(df[var])
        lignes.append(ligne)

    for var in vars_categorielles:
        modalites = sorted(df[var].dropna().unique())
        lignes.append({"Variable": f"--- {var} ---"})
        for mod in modalites:
            ligne = {"Variable": f"  {mod}, n (%)"}
            for g in genes:
                sous = df[df[col_gene] == g]
                n_g = len(sous)
                n_mod = (sous[var] == mod).sum()
                pct = 100 * n_mod / n_g if n_g > 0 else np.nan
                ligne[g] = f"{n_mod} ({pct:.1f}%)" if n_g > 0 else "NA"
            n_tot = len(df)
            n_mod_tot = (df[var] == mod).sum()
            ligne["Ensemble"] = f"{n_mod_tot} ({100 * n_mod_tot / n_tot:.1f}%)"
            lignes.append(ligne)

    return pd.DataFrame(lignes)




def cramers_v(tableau: pd.DataFrame, chi2_stat: float) -> float:
    
    n = tableau.values.sum()
    r, k = tableau.shape
    phi2 = chi2_stat / n
    phi2_corr = max(0, phi2 - ((k - 1) * (r - 1)) / (n - 1))
    r_corr = r - ((r - 1) ** 2) / (n - 1)
    k_corr = k - ((k - 1) ** 2) / (n - 1)
    denom = min(k_corr - 1, r_corr - 1)
    if denom <= 0:
        return np.nan
    return float(np.sqrt(phi2_corr / denom))


def residus_standardises_ajustes(tableau: pd.DataFrame) -> pd.DataFrame:
    
    observe = tableau.values.astype(float)
    n = observe.sum()
    total_lignes = observe.sum(axis=1, keepdims=True)
    total_colonnes = observe.sum(axis=0, keepdims=True)
    attendu = total_lignes @ total_colonnes / n
    residu_brut = observe - attendu
    denom = np.sqrt(attendu * (1 - total_lignes / n) * (1 - total_colonnes / n))
    residus = residu_brut / denom
    return pd.DataFrame(residus, index=tableau.index, columns=tableau.columns)


def epsilon_carre_kruskal(h_stat: float, n_total: int, k_groupes: int) -> float:
    
    if n_total - k_groupes <= 0:
        return np.nan
    return float((h_stat - k_groupes + 1) / (n_total - k_groupes))


def dunn_posthoc(df: pd.DataFrame, col_gene: str, col_outcome: str) -> pd.DataFrame:
    
    sous = df[[col_gene, col_outcome]].dropna().copy()
    sous["rang"] = stats.rankdata(sous[col_outcome])
    n_total = len(sous)

    groupes = sous.groupby(col_gene)
    stats_par_groupe = groupes["rang"].agg(["mean", "count"])

    valeurs_uniques, effectifs_ties = np.unique(sous[col_outcome], return_counts=True)
    correction_ties = 1 - np.sum(effectifs_ties ** 3 - effectifs_ties) / (n_total ** 3 - n_total)
    if correction_ties <= 0:
        correction_ties = 1.0

    noms = stats_par_groupe.index.tolist()
    resultats = []
    for i in range(len(noms)):
        for j in range(i + 1, len(noms)):
            g1, g2 = noms[i], noms[j]
            r1, n1 = stats_par_groupe.loc[g1, ["mean", "count"]]
            r2, n2 = stats_par_groupe.loc[g2, ["mean", "count"]]
            se = np.sqrt(correction_ties * (n_total * (n_total + 1) / 12) * (1 / n1 + 1 / n2))
            z = (r1 - r2) / se if se > 0 else np.nan
            p_brut = 2 * (1 - stats.norm.cdf(abs(z))) if not np.isnan(z) else np.nan
            resultats.append({"groupe_1": g1, "groupe_2": g2, "n1": int(n1), "n2": int(n2),
                               "z": z, "p_value": p_brut})

    df_res = pd.DataFrame(resultats)
    if len(df_res) > 0 and df_res["p_value"].notna().any():
        valides = df_res["p_value"].notna()
        _, p_corr, _, _ = multipletests(df_res.loc[valides, "p_value"], alpha=ALPHA, method="fdr_bh")
        df_res.loc[valides, "p_value_fdr"] = p_corr
        df_res["significatif_fdr"] = df_res["p_value_fdr"] < ALPHA
    return df_res


def test_gene_vs_categorielle(df: pd.DataFrame, col_gene: str, col_outcome: str) -> dict:
    
    tableau = pd.crosstab(df[col_gene], df[col_outcome])
    residus = None
    taille_effet = None
    nom_effet = None

    if tableau.shape == (2, 2):
        odds_ratio, p_value = stats.fisher_exact(tableau)
        methode = "Fisher exact"
        stat_val = odds_ratio
    else:
        stat_val, p_value, dof, _ = stats.chi2_contingency(tableau)
        methode = "Chi² d'indépendance"
        taille_effet = cramers_v(tableau, stat_val)
        nom_effet = "V de Cramér"
        if p_value < ALPHA:
            residus = residus_standardises_ajustes(tableau)

    return {
        "variable": col_outcome,
        "methode": methode,
        "statistique": stat_val,
        "p_value": p_value,
        "n": int(tableau.values.sum()),
        "taille_effet": taille_effet,
        "nom_taille_effet": nom_effet,
        "tableau_contingence": tableau,
        "residus_standardises": residus,
    }


def test_gene_vs_continue(df: pd.DataFrame, col_gene: str, col_outcome: str,
                           n_min: int = None) -> dict:
    
    n_min = N_MIN_SOUS_GROUPE if n_min is None else n_min
    sous = df[[col_gene, col_outcome]].dropna()
    effectifs = sous[col_gene].value_counts()
    genes_valides = effectifs[effectifs >= n_min].index
    sous = sous[sous[col_gene].isin(genes_valides)]
    groupes = [g[col_outcome].values for _, g in sous.groupby(col_gene)]

    if len(groupes) < 2:
        return {"variable": col_outcome, "methode": "Kruskal-Wallis",
                "statistique": np.nan, "p_value": np.nan, "n": len(sous),
                "taille_effet": np.nan, "nom_taille_effet": "epsilon²",
                "posthoc_dunn": None, "commentaire": "Pas assez de sous-groupes valides"}

    stat_val, p_value = stats.kruskal(*groupes)
    epsilon2 = epsilon_carre_kruskal(stat_val, len(sous), len(groupes))

    posthoc = None
    if p_value < ALPHA and len(groupes) > 2:
        posthoc = dunn_posthoc(sous, col_gene, col_outcome)

    return {
        "variable": col_outcome,
        "methode": "Kruskal-Wallis",
        "statistique": stat_val,
        "p_value": p_value,
        "n": int(sous.shape[0]),
        "taille_effet": epsilon2,
        "nom_taille_effet": "epsilon²",
        "posthoc_dunn": posthoc,
    }


def regression_logistique_pharmacoresistance(df: pd.DataFrame, col_gene: str) -> pd.DataFrame:
    
    sous = df[[col_gene, "statut_calcule_ilae", "age_debut_crises_mois"]].dropna()
    sous["statut_calcule_ilae"] = sous["statut_calcule_ilae"].astype(int)

    gene_reference = sous[col_gene].value_counts().idxmax()
    sous[col_gene] = pd.Categorical(sous[col_gene])
    sous[col_gene] = sous[col_gene].cat.reorder_categories(
        [gene_reference] + [g for g in sous[col_gene].cat.categories if g != gene_reference]
    )

    X = pd.get_dummies(sous[[col_gene, "age_debut_crises_mois"]],
                        columns=[col_gene], drop_first=True)
    X = sm.add_constant(X.astype(float))
    y = sous["statut_calcule_ilae"]

    modele = sm.Logit(y, X).fit(disp=0)

    resultats = pd.DataFrame({
        "coefficient": modele.params,
        "OR": np.exp(modele.params),
        "IC95_inf": np.exp(modele.conf_int()[0]),
        "IC95_sup": np.exp(modele.conf_int()[1]),
        "p_value": modele.pvalues,
    })
    resultats.attrs["gene_reference"] = gene_reference
    resultats.attrs["n"] = int(sous.shape[0])
    return resultats


def appliquer_correction_fdr(liste_resultats: list) -> pd.DataFrame:
    df_res = pd.DataFrame(liste_resultats)
    p_valides = df_res["p_value"].notna()
    rejet, p_corrige, _, _ = multipletests(
        df_res.loc[p_valides, "p_value"], alpha=ALPHA, method="fdr_bh"
    )
    df_res.loc[p_valides, "p_value_fdr"] = p_corrige
    df_res.loc[p_valides, "significatif_apres_fdr"] = rejet
    return df_res


def figure_boxplot_par_gene(df: pd.DataFrame, col_gene: str, col_outcome: str,
                             titre: str, nom_fichier: str) -> str:
    fig, ax = plt.subplots(figsize=(9, 5.5))
    ordre = sorted(df[col_gene].dropna().unique())
    sns.boxplot(data=df, x=col_gene, y=col_outcome, order=ordre, ax=ax, showfliers=False)
    sns.stripplot(data=df, x=col_gene, y=col_outcome, order=ordre, ax=ax,
                   color="black", alpha=0.4, size=3, jitter=0.2)
    ax.set_title(titre, fontsize=13, fontweight="bold")
    ax.set_xlabel("Gène")
    ax.set_ylabel(col_outcome)
    plt.xticks(rotation=40, ha="right")
    plt.tight_layout()
    chemin = os.path.join(DOSSIER_FIGURES, nom_fichier)
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    return chemin


def figure_heatmap_contingence(tableau: pd.DataFrame, titre: str, nom_fichier: str) -> str:
    fig, ax = plt.subplots(figsize=(max(6, 0.9 * tableau.shape[1] + 3),
                                     max(4, 0.6 * tableau.shape[0] + 2)))
    sns.heatmap(tableau, annot=True, fmt="d", cmap="YlOrRd", ax=ax, cbar_kws={"label": "n patients"})
    ax.set_title(titre, fontsize=13, fontweight="bold")
    ax.set_ylabel("Gène")
    plt.xticks(rotation=40, ha="right")
    plt.tight_layout()
    chemin = os.path.join(DOSSIER_FIGURES, nom_fichier)
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    return chemin


def figure_heatmap_residus(residus: pd.DataFrame, titre: str, nom_fichier: str) -> str:
    fig, ax = plt.subplots(figsize=(max(6, 0.9 * residus.shape[1] + 3),
                                     max(4, 0.6 * residus.shape[0] + 2)))
    sns.heatmap(residus, annot=True, fmt=".1f", cmap="coolwarm", center=0, ax=ax,
                cbar_kws={"label": "Résidu standardisé ajusté"}, vmin=-4, vmax=4)
    ax.set_title(titre + "\n(|résidu| > 1.96 ≈ significatif à p<.05)", fontsize=12, fontweight="bold")
    ax.set_ylabel("Gène")
    plt.xticks(rotation=40, ha="right")
    plt.tight_layout()
    chemin = os.path.join(DOSSIER_FIGURES, nom_fichier)
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    return chemin


def figure_effectifs_par_gene(df: pd.DataFrame, col_gene: str, nom_fichier: str) -> str:
    fig, ax = plt.subplots(figsize=(8, 5))
    effectifs = df[col_gene].value_counts().sort_values(ascending=True)
    effectifs.plot(kind="barh", ax=ax, color=sns.color_palette("Set2")[0])
    ax.axvline(N_MIN_SOUS_GROUPE, color="red", linestyle="--", linewidth=1,
               label=f"N_MIN = {N_MIN_SOUS_GROUPE}")
    ax.set_title("Effectifs par gène (sous-groupes retenus)", fontsize=13, fontweight="bold")
    ax.set_xlabel("n patients")
    ax.legend()
    plt.tight_layout()
    chemin = os.path.join(DOSSIER_FIGURES, nom_fichier)
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    return chemin


def figure_sensibilite_n_min(df_sensibilite: pd.DataFrame, nom_fichier: str) -> str:
    fig, ax = plt.subplots(figsize=(8, 5))
    for variable in df_sensibilite["variable"].unique():
        sous = df_sensibilite[df_sensibilite["variable"] == variable]
        ax.plot(sous["n_min"], sous["p_value"], marker="o", label=variable)
    ax.axhline(ALPHA, color="red", linestyle="--", linewidth=1, label=f"alpha = {ALPHA}")
    ax.set_xlabel("N_MIN (taille minimale de sous-groupe)")
    ax.set_ylabel("p-value (non corrigée)")
    ax.set_title("Analyse de sensibilité — stabilité des p-values selon N_MIN",
                  fontsize=12, fontweight="bold")
    ax.legend(fontsize=8)
    plt.tight_layout()
    chemin = os.path.join(DOSSIER_FIGURES, nom_fichier)
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    return chemin


def analyse_sensibilite_n_min(df: pd.DataFrame, col_gene: str = "gene_teste") -> pd.DataFrame:
    
    lignes = []
    for n_min in GRILLE_N_MIN_SENSIBILITE:
        df_filtre = filtrer_sous_groupes_valides(df, col_gene, n_min=n_min, verbeux=False)
        n_genes = df_filtre[col_gene].nunique()

        res_freq = test_gene_vs_continue(df_filtre, col_gene, "frequence_moyenne_mois", n_min=n_min)
        res_age = test_gene_vs_continue(df_filtre, col_gene, "age_debut_crises_mois", n_min=n_min)

        for res, nom in [(res_freq, "fréquence des crises"), (res_age, "âge de début des crises")]:
            lignes.append({
                "n_min": n_min,
                "n_genes_inclus": n_genes,
                "n_patients": len(df_filtre),
                "variable": nom,
                "statistique_H": res["statistique"],
                "p_value": res["p_value"],
                "epsilon2": res.get("taille_effet"),
            })

        if df_filtre[col_gene].nunique() >= 2:
            res_crise = test_gene_vs_categorielle(df_filtre, col_gene, "type_crise_ilae2017")
            lignes.append({
                "n_min": n_min,
                "n_genes_inclus": n_genes,
                "n_patients": len(df_filtre),
                "variable": "type de crise (ILAE 2017)",
                "statistique_H": res_crise["statistique"],
                "p_value": res_crise["p_value"],
                "epsilon2": res_crise.get("taille_effet"),
            })

    return pd.DataFrame(lignes)


def analyse_sensibilite_classes_acmg(construire_dataset_fn) -> pd.DataFrame:
    
    global CLASSES_ACMG_CAUSALES
    scenarios = {
        "Classe V uniquement (strict)": ["Classe V"],
        "Classe IV + V (retenu)": ["Classe IV", "Classe V"],
        "Classe III + IV + V (élargi, exploratoire)": ["Classe III", "Classe IV", "Classe V"],
    }
    classes_originales = CLASSES_ACMG_CAUSALES
    lignes = []
    for nom_scenario, classes in scenarios.items():
        CLASSES_ACMG_CAUSALES = classes
        try:
            df_scenario = construire_dataset_fn()
            n_patients = df_scenario["pseudonyme"].nunique()
            n_genes = df_scenario["gene_teste"].nunique()
        except Exception as exc:
            n_patients, n_genes = np.nan, np.nan
            print(f"[ATTENTION] scénario '{nom_scenario}' non évaluable : {exc}")
        lignes.append({"scenario_ACMG": nom_scenario, "classes": classes,
                        "n_patients": n_patients, "n_genes_distincts": n_genes})
    CLASSES_ACMG_CAUSALES = classes_originales
    return pd.DataFrame(lignes)


def main():
    sortie = StringIO()

    def afficher(texte=""):
        print(texte)
        sortie.write(str(texte) + "\n")

    afficher("=" * 80)
    afficher("Analyse de sous-groupes par gène — corrélation génotype-phénotype (EPR)")
    afficher(f"Mode de données : {MODE_DONNEES}")
    afficher("=" * 80)

    df = construire_dataset()
    afficher(f"\n[INFO] {df['pseudonyme'].nunique()} patients avec variant causal "
              f"(classes ACMG retenues : {CLASSES_ACMG_CAUSALES})")

    df_valide = filtrer_sous_groupes_valides(df, col_gene="gene_teste")
    afficher(f"[INFO] {df_valide.shape[0]} patients retenus après filtre "
              f"n >= {N_MIN_SOUS_GROUPE} par gène")
    afficher(f"[INFO] Sous-groupes analysés : {sorted(df_valide['gene_teste'].unique())}")

    figures_generees = []

    figures_generees.append(
        figure_effectifs_par_gene(df, "gene_teste", "00_effectifs_par_gene.png")
    )

    afficher("\n" + "=" * 80)
    afficher("TABLE 1 — Statistiques descriptives par sous-groupe (gène)")
    afficher("=" * 80)
    table1 = construire_table1_descriptive(
        df_valide, "gene_teste",
        vars_continues=["frequence_moyenne_mois", "age_debut_crises_mois"],
        vars_categorielles=["type_crise_ilae2017", "statut_calcule_ilae"],
    )
    afficher(table1.to_string(index=False))
    table1.to_csv(os.path.join(DOSSIER_SORTIE, "table1_descriptive.csv"), index=False)

    resultats_bruts = []

    afficher("\n" + "=" * 80)
    afficher("Gène vs type de crise (ILAE 2017)")
    afficher("=" * 80)
    res_crise = test_gene_vs_categorielle(df_valide, "gene_teste", "type_crise_ilae2017")
    afficher(res_crise["tableau_contingence"].to_string())
    afficher(f"\n{res_crise['methode']} : statistique={res_crise['statistique']:.3f}, "
              f"p={res_crise['p_value']:.4f}, n={res_crise['n']}")
    if res_crise["taille_effet"] is not None:
        afficher(f"{res_crise['nom_taille_effet']} (taille d'effet) = {res_crise['taille_effet']:.3f} "
                  f"({'négligeable' if res_crise['taille_effet']<0.1 else 'faible' if res_crise['taille_effet']<0.3 else 'modérée' if res_crise['taille_effet']<0.5 else 'forte'})")

    figures_generees.append(figure_heatmap_contingence(
        res_crise["tableau_contingence"], "Type de crise (ILAE 2017) par gène",
        "01_heatmap_type_crise_par_gene.png"
    ))

    if res_crise["residus_standardises"] is not None:
        afficher("\nRésidus standardisés ajustés (localisation de l'écart à l'indépendance) :")
        afficher(res_crise["residus_standardises"].round(2).to_string())
        figures_generees.append(figure_heatmap_residus(
            res_crise["residus_standardises"],
            "Résidus standardisés ajustés — Gène x Type de crise",
            "02_heatmap_residus_type_crise.png"
        ))
    resultats_bruts.append({k: v for k, v in res_crise.items()
                             if k not in ("tableau_contingence", "residus_standardises")})

    afficher("\n" + "=" * 80)
    afficher("Gène vs fréquence des crises (crises/mois)")
    afficher("=" * 80)
    res_freq = test_gene_vs_continue(df_valide, "gene_teste", "frequence_moyenne_mois")
    afficher(f"Kruskal-Wallis : H={res_freq['statistique']:.3f}, p={res_freq['p_value']:.4f}, "
              f"n={res_freq['n']}, epsilon²={res_freq['taille_effet']:.3f}"
              if not np.isnan(res_freq["statistique"]) else "Test non réalisable (sous-groupes insuffisants)")
    if res_freq.get("posthoc_dunn") is not None:
        afficher("\nPost-hoc de Dunn (comparaisons 2 à 2, correction FDR) :")
        afficher(res_freq["posthoc_dunn"].round(4).to_string(index=False))
    figures_generees.append(figure_boxplot_par_gene(
        df_valide, "gene_teste", "frequence_moyenne_mois",
        "Fréquence des crises par gène", "03_boxplot_frequence_par_gene.png"
    ))
    resultats_bruts.append({k: v for k, v in res_freq.items() if k != "posthoc_dunn"})

    afficher("\n" + "=" * 80)
    afficher("Gène vs âge de début des crises (mois)")
    afficher("=" * 80)
    res_age = test_gene_vs_continue(df_valide, "gene_teste", "age_debut_crises_mois")
    afficher(f"Kruskal-Wallis : H={res_age['statistique']:.3f}, p={res_age['p_value']:.4f}, "
              f"n={res_age['n']}, epsilon²={res_age['taille_effet']:.3f}"
              if not np.isnan(res_age["statistique"]) else "Test non réalisable (sous-groupes insuffisants)")
    if res_age.get("posthoc_dunn") is not None:
        afficher("\nPost-hoc de Dunn (comparaisons 2 à 2, correction FDR) :")
        afficher(res_age["posthoc_dunn"].round(4).to_string(index=False))
    figures_generees.append(figure_boxplot_par_gene(
        df_valide, "gene_teste", "age_debut_crises_mois",
        "Âge de début des crises par gène", "04_boxplot_age_debut_par_gene.png"
    ))
    resultats_bruts.append({k: v for k, v in res_age.items() if k != "posthoc_dunn"})

    afficher("\n" + "=" * 80)
    afficher("Gène vs pharmacorésistance (régression logistique, ajustée âge début)")
    afficher("=" * 80)
    res_logit = regression_logistique_pharmacoresistance(df_valide, "gene_teste")
    afficher(f"Référence : {res_logit.attrs['gene_reference']} | n = {res_logit.attrs['n']}")
    afficher(res_logit.round(4).to_string())
    for gene_dummy, ligne in res_logit.iterrows():
        if gene_dummy.startswith("gene_teste_"):
            resultats_bruts.append({
                "variable": f"pharmacoresistance ({gene_dummy})",
                "methode": "Régression logistique (OR)",
                "statistique": ligne["OR"],
                "p_value": ligne["p_value"],
                "n": res_logit.attrs["n"],
                "taille_effet": np.nan,
                "nom_taille_effet": None,
            })

    afficher("\n" + "=" * 80)
    afficher("Synthèse avec correction pour comparaisons multiples (Benjamini-Hochberg)")
    afficher("=" * 80)
    synthese = appliquer_correction_fdr(resultats_bruts)
    colonnes_affichees = ["variable", "methode", "p_value", "p_value_fdr",
                           "significatif_apres_fdr", "n", "taille_effet", "nom_taille_effet"]
    afficher(synthese[colonnes_affichees].to_string(index=False))
    synthese.to_csv(os.path.join(DOSSIER_SORTIE, "resultats_genotype_phenotype_epr.csv"), index=False)

    afficher("\n" + "=" * 80)
    afficher(f"Analyse de sensibilité — N_MIN ∈ {GRILLE_N_MIN_SENSIBILITE}")
    afficher("=" * 80)
    sensibilite_n_min = analyse_sensibilite_n_min(df, "gene_teste")
    afficher(sensibilite_n_min.round(4).to_string(index=False))
    afficher(
        "\nInterprétation : si le statut de significativité (p<0.05) et le sens "
        "de l'effet (epsilon²/statistique) restent stables à travers la grille "
        "de N_MIN, la conclusion n'est pas un artefact du seuil H3 choisi."
    )
    sensibilite_n_min.to_csv(os.path.join(DOSSIER_SORTIE, "sensibilite_n_min.csv"), index=False)
    figures_generees.append(
        figure_sensibilite_n_min(sensibilite_n_min, "05_sensibilite_n_min.png")
    )

    afficher("\n" + "=" * 80)
    afficher("Analyse de sensibilité — seuil ACMG retenu comme variant causal (H1)")
    afficher("=" * 80)
    try:
        sensibilite_acmg = analyse_sensibilite_classes_acmg(construire_dataset)
        afficher(sensibilite_acmg.to_string(index=False))
        afficher(
            "\n[NOTE] Le scénario 'Classe III+IV+V' est exploratoire (VUS = variant de "
            "signification incertaine) : à ne pas utiliser pour des conclusions "
            "cliniques, seulement pour juger de la sensibilité de la taille de cohorte."
        )
        sensibilite_acmg.to_csv(os.path.join(DOSSIER_SORTIE, "sensibilite_classes_acmg.csv"), index=False)
    except Exception as exc:
        afficher(f"[ATTENTION] Analyse de sensibilité ACMG non réalisée : {exc}")

    afficher("\n" + "=" * 80)
    afficher("Figures générées")
    afficher("=" * 80)
    for chemin in figures_generees:
        afficher(f" - {chemin}")

    chemin_rapport = os.path.join(DOSSIER_SORTIE, "rapport_complet.txt")
    with open(chemin_rapport, "w", encoding="utf-8") as f:
        f.write(sortie.getvalue())

    print(f"\n[OK] Rapport texte complet exporté vers {chemin_rapport}")
    print(f"[OK] Figures exportées dans {DOSSIER_FIGURES}/")
    print(f"[OK] Tableaux CSV exportés dans {DOSSIER_SORTIE}/")


if __name__ == "__main__":
    main()

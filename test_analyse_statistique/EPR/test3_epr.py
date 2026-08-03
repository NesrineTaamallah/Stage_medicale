

import contextlib
import os
import sys

import matplotlib
matplotlib.use("Agg") 
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.stats.multicomp import pairwise_tukeyhsd



class Tee:
    

    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)

    def flush(self):
        for s in self.streams:
            s.flush()


SQL_QUERY = """
WITH type_crise_retenu AS (
    -- un seul type de crise par patient : le plus récent avant analyse
    SELECT DISTINCT ON (pseudonyme)
        pseudonyme,
        type_crise_ilae2017,
        sous_type,
        date_observation
    FROM epr_type_crise
    ORDER BY pseudonyme, date_observation DESC
)
SELECT
    p.pseudonyme,
    p.age,
    tc.type_crise_ilae2017,
    tc.sous_type,
    nae.nb_ae_essayes,
    pr.statut_pharmacoresistance_confirme
FROM patients p
JOIN type_crise_retenu tc   ON tc.pseudonyme = p.pseudonyme
JOIN v_epr_nb_ae nae        ON nae.pseudonyme = p.pseudonyme
LEFT JOIN epr_pharmacoresistance pr ON pr.pseudonyme = p.pseudonyme
WHERE p.registre = 'EPRLEPSIE';
"""



def extraire_donnees(conn=None, chemin_csv=None):
    
    if conn is not None:
        return pd.read_sql(SQL_QUERY, conn)
    if chemin_csv is not None:
        return pd.read_csv(chemin_csv)
    raise ValueError("Fournir soit `conn` (connexion PostgreSQL), soit `chemin_csv`.")




def nettoyer_valeurs_manquantes(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    n_total = len(df)
    rapport = {}

    masque_nae_manquant = df["nb_ae_essayes"].isna()
    rapport["nb_ae_essayes manquant (NULL)"] = int(masque_nae_manquant.sum())
    df = df[~masque_nae_manquant]

    masque_type_manquant = df["type_crise_ilae2017"].isna() | (
        df["type_crise_ilae2017"].astype(str).str.strip().str.upper() == "NA"
    )
    rapport["type_crise_ilae2017 manquant (NULL/'NA')"] = int(masque_type_manquant.sum())
    df = df[~masque_type_manquant]

    
    masque_sous_type_na_litteral = (
        df["sous_type"].astype(str).str.strip().str.upper() == "NA"
    )
    rapport["sous_type = 'NA' littéral (non applicable, conservé)"] = int(
        masque_sous_type_na_litteral.sum()
    )
    df.loc[masque_sous_type_na_litteral | df["sous_type"].isna(), "sous_type"] = np.nan

    print("\n--- Rapport de gestion des valeurs manquantes ---")
    print(f"Patients extraits initialement : {n_total}")
    for motif, n in rapport.items():
        print(f"  Exclus pour '{motif}' : {n}")
    print(f"Patients retenus pour l'analyse : {len(df)} ({len(df) / n_total:.1%})")

    if len(df) < n_total * 0.8:
        print("  /!\\ Plus de 20% des patients exclus pour données manquantes -> "
              "à signaler à l'encadrante avant d'interpréter le test.")

    return df



def construire_groupe_crise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    
    sous_type_norm = df["sous_type"].apply(
        lambda x: x.lower() if isinstance(x, str) else ""
    )
    sous_type_est_manquant = df["sous_type"].isna()

    def classer(row):
        type_ilae = row["type_crise_ilae2017"]
        st = row["_sous_type_norm"]
        if row["_sous_type_manquant"] and type_ilae == "Focale":
            
            return "Focale (sous-type non renseigné)"
        if type_ilae == "Focale" and (
            "généralisation secondaire" in st
            or "bilaterale" in st
            or "bilatérale" in st
            or "focal to bilateral" in st
        ):
            return "Focale avec généralisation secondaire"
        if "spasme" in st:
            return "Spasmes"
        if type_ilae == "Focale":
            return "Focale (sans généralisation secondaire)"
        if type_ilae == "Généralisée":
            return "Généralisée (autre)"
        return "Inconnue / non classée"

    df["_sous_type_norm"] = sous_type_norm
    df["_sous_type_manquant"] = sous_type_est_manquant
    df["groupe_crise"] = df.apply(classer, axis=1)
    df = df.drop(columns=["_sous_type_norm", "_sous_type_manquant"])
    return df


def filtrer_effectifs_faibles(df: pd.DataFrame, groupe_col="groupe_crise", n_min=5):
    
    effectifs = df[groupe_col].value_counts()
    groupes_faibles = effectifs[effectifs < n_min].index.tolist()

    if groupes_faibles:
        print(f"\n/!\\ Groupe(s) avec effectif < {n_min}, exclus de l'ANOVA "
              f"(non interprétables statistiquement) :")
        for g in groupes_faibles:
            print(f"    '{g}' : n={effectifs[g]}")
        print("    -> à signaler à l'encadrante : fusionner avec un groupe clinique "
              "pertinent, ou attendre davantage de patients inclus dans ce sous-groupe.")
        df = df[~df[groupe_col].isin(groupes_faibles)]

    return df




def descriptives(df: pd.DataFrame) -> pd.DataFrame:
    desc = (
        df.groupby("groupe_crise")["nb_ae_essayes"]
        .agg(n="count", moyenne="mean", ecart_type="std", mediane="median",
             min="min", max="max")
        .round(2)
        .sort_values("moyenne", ascending=False)
    )
    return desc




def verifier_hypotheses(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    print("\n--- Vérification des hypothèses ANOVA ---")

    normalite_ok = True
    print("\nNormalité (Shapiro-Wilk) par groupe :")
    for g, sous_df in df.groupby(groupe_col):
        valeurs = sous_df[valeur_col].dropna()
        if len(valeurs) >= 3:
            stat, p = stats.shapiro(valeurs)
            verdict = "normalité rejetée (p<0.05)" if p < 0.05 else "normalité non rejetée"
            if p < 0.05:
                normalite_ok = False
            print(f"  {g:45s} n={len(valeurs):3d}  W={stat:.3f}  p={p:.4f}  -> {verdict}")
        else:
            print(f"  {g:45s} n={len(valeurs):3d}  -> effectif insuffisant pour Shapiro")

    groupes_valeurs = [sous_df[valeur_col].dropna().values
                        for _, sous_df in df.groupby(groupe_col)
                        if len(sous_df[valeur_col].dropna()) >= 2]
    stat_lev, p_lev = stats.levene(*groupes_valeurs)
    variances_ok = p_lev >= 0.05
    print(f"\nHomogénéité des variances (Levene) : W={stat_lev:.3f}  p={p_lev:.4f}")
    if p_lev < 0.05:
        print("  -> variances hétérogènes : interpréter l'ANOVA classique avec prudence,")
        print("     Welch-ANOVA déclenchée automatiquement ci-dessous.")
    else:
        print("  -> hypothèse d'homogénéité des variances non rejetée.")

    return normalite_ok, variances_ok




def anova_un_facteur(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    print("\n--- ANOVA à un facteur : nb_ae_essayes ~ groupe_crise ---")

    modele = smf.ols(f"{valeur_col} ~ C({groupe_col})", data=df).fit()
    table_anova = sm.stats.anova_lm(modele, typ=2)
    print(table_anova)

    p_value = table_anova["PR(>F)"].iloc[0]
    if p_value < 0.05:
        print(f"\n=> p = {p_value:.4f} < 0.05 : on rejette H0, le nombre moyen d'AE essayés "
              f"diffère significativement selon le type de crise.")
    else:
        print(f"\n=> p = {p_value:.4f} >= 0.05 : pas de différence significative détectée "
              f"entre les groupes (H0 non rejetée).")

    return modele, table_anova


def posthoc_tukey(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    print("\n--- Post-hoc Tukey HSD (si ANOVA significative) ---")
    tukey = pairwise_tukeyhsd(
        endog=df[valeur_col], groups=df[groupe_col], alpha=0.05
    )
    print(tukey)
    return tukey


def welch_anova(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    
    print("\n--- Welch-ANOVA (ne suppose pas l'homogénéité des variances) ---")

    groupes = df.groupby(groupe_col)[valeur_col]
    k = groupes.ngroups
    n_i = groupes.count()
    moy_i = groupes.mean()
    var_i = groupes.var(ddof=1)

    w_i = n_i / var_i
    w_total = w_i.sum()
    moy_ponderee = (w_i * moy_i).sum() / w_total

    numerateur = (w_i * (moy_i - moy_ponderee) ** 2).sum() / (k - 1)

    terme = (1 - w_i / w_total) ** 2 / (n_i - 1)
    denom_ajust = 1 + (2 * (k - 2) / (k ** 2 - 1)) * terme.sum()
    F_welch = numerateur / denom_ajust

    ddl1 = k - 1
    ddl2 = (k ** 2 - 1) / (3 * terme.sum())

    p_value = stats.f.sf(F_welch, ddl1, ddl2)

    print(f"F(Welch) = {F_welch:.3f}   ddl1 = {ddl1}   ddl2 = {ddl2:.1f}   p = {p_value:.4f}")
    if p_value < 0.05:
        print("=> p < 0.05 : différence significative confirmée même sans supposer "
              "l'homogénéité des variances -> résultat plus robuste que l'ANOVA classique ici.")
    else:
        print("=> p >= 0.05 : pas de différence significative une fois les variances "
              "hétérogènes prises en compte -> à comparer avec le résultat de l'ANOVA classique, "
              "qui peut être optimiste en cas de variances inégales.")

    if k > 2:
        print("Post-hoc recommandé si significatif : Games-Howell (ne suppose pas non plus "
              "l'égalité des variances) plutôt que Tukey HSD classique.")

    return F_welch, ddl1, ddl2, p_value




def kruskal_wallis(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    print("\n--- Kruskal-Wallis (alternative non paramétrique, si normalité violée) ---")
    groupes_valeurs = [sous_df[valeur_col].dropna().values
                        for _, sous_df in df.groupby(groupe_col)]
    stat, p = stats.kruskal(*groupes_valeurs)
    print(f"H = {stat:.3f}  p = {p:.4f}")
    if p < 0.05:
        print("=> confirme une différence significative entre groupes (cohérent/à comparer avec l'ANOVA).")
    else:
        print("=> pas de différence significative détectée.")
    return stat, p


def regression_poisson(df: pd.DataFrame, groupe_col="groupe_crise", valeur_col="nb_ae_essayes"):
    
    print("\n--- Régression de Poisson : nb_ae_essayes ~ groupe_crise (analyse de sensibilité) ---")
    modele = smf.glm(
        f"{valeur_col} ~ C({groupe_col})", data=df, family=sm.families.Poisson()
    ).fit()
    print(modele.summary())

    pearson_chi2 = modele.pearson_chi2
    ddl = modele.df_resid
    ratio = pearson_chi2 / ddl
    print(f"\nRatio de dispersion (Pearson chi2 / ddl) = {ratio:.2f}")
    if ratio > 1.5:
        print("  -> surdispersion suspectée : envisager un modèle binomial négatif.")
    return modele



def graphique_boxplot(df, groupe_col="groupe_crise", valeur_col="nb_ae_essayes",
                       dossier_sortie="."):
    
    ordre = df.groupby(groupe_col)[valeur_col].median().sort_values(ascending=False).index
    data_par_groupe = [df.loc[df[groupe_col] == g, valeur_col].dropna().values for g in ordre]

    fig, ax = plt.subplots(figsize=(10, 6))
    bp = ax.boxplot(data_par_groupe, labels=ordre, patch_artist=True, showmeans=True)
    for patch in bp["boxes"]:
        patch.set_facecolor("#a8d0e6")

    rng = np.random.default_rng(0)
    for i, valeurs in enumerate(data_par_groupe, start=1):
        x_jitter = rng.normal(i, 0.05, size=len(valeurs))
        ax.scatter(x_jitter, valeurs, alpha=0.4, color="#2c3e50", s=15, zorder=3)

    ax.set_ylabel("Nombre d'AE essayés avant contrôle")
    ax.set_xlabel("Type de crise")
    ax.set_title("Nombre d'AE essayés par type de crise (ILAE 2017)")
    plt.setp(ax.get_xticklabels(), rotation=25, ha="right")
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_boxplot_type_crise.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def graphique_qqplots(df, groupe_col="groupe_crise", valeur_col="nb_ae_essayes",
                       dossier_sortie="."):
    
    groupes = list(df.groupby(groupe_col))
    n_groupes = len(groupes)
    n_cols = 3
    n_lignes = int(np.ceil(n_groupes / n_cols))

    fig, axes = plt.subplots(n_lignes, n_cols, figsize=(5 * n_cols, 4 * n_lignes))
    axes = np.array(axes).reshape(-1)

    for ax, (g, sous_df) in zip(axes, groupes):
        valeurs = sous_df[valeur_col].dropna()
        if len(valeurs) >= 3:
            stats.probplot(valeurs, dist="norm", plot=ax)
        ax.set_title(g, fontsize=9)

    for ax in axes[len(groupes):]:
        ax.axis("off")

    fig.suptitle("QQ-plots par groupe (vérification visuelle de la normalité)")
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_qqplots_type_crise.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def graphique_histogrammes(df, groupe_col="groupe_crise", valeur_col="nb_ae_essayes",
                            dossier_sortie="."):
    
    groupes = list(df.groupby(groupe_col))
    n_groupes = len(groupes)
    n_cols = 3
    n_lignes = int(np.ceil(n_groupes / n_cols))

    val_max = int(df[valeur_col].max())
    bins = np.arange(1, val_max + 2) - 0.5

    fig, axes = plt.subplots(n_lignes, n_cols, figsize=(5 * n_cols, 3.5 * n_lignes), sharex=True)
    axes = np.array(axes).reshape(-1)

    for ax, (g, sous_df) in zip(axes, groupes):
        valeurs = sous_df[valeur_col].dropna()
        ax.hist(valeurs, bins=bins, color="#a8d0e6", edgecolor="#2c3e50")
        ax.axvline(valeurs.mean(), color="red", linestyle="--", linewidth=1,
                   label=f"moyenne={valeurs.mean():.1f}")
        ax.set_title(f"{g} (n={len(valeurs)})", fontsize=9)
        ax.legend(fontsize=7)

    for ax in axes[len(groupes):]:
        ax.axis("off")

    fig.suptitle("Distribution de nb_ae_essayes par groupe (variable de comptage)")
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_histogrammes_type_crise.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def graphique_forest_posthoc(tukey_result, dossier_sortie="."):
    
    data = tukey_result.summary().data
    entetes, lignes = data[0], data[1:]
    df_tukey = pd.DataFrame(lignes, columns=entetes)
    df_tukey["meandiff"] = df_tukey["meandiff"].astype(float)
    df_tukey["lower"] = df_tukey["lower"].astype(float)
    df_tukey["upper"] = df_tukey["upper"].astype(float)
    df_tukey["reject"] = df_tukey["reject"].astype(str) == "True"
    df_tukey["comparaison"] = df_tukey["group1"] + " vs " + df_tukey["group2"]
    df_tukey = df_tukey.sort_values("meandiff")

    fig, ax = plt.subplots(figsize=(9, 0.5 * len(df_tukey) + 2))
    couleurs = df_tukey["reject"].map({True: "#c0392b", False: "#7f8c8d"}).tolist()

    y_pos = np.arange(len(df_tukey))
    for y, meandiff, lo, hi, coul in zip(
        y_pos, df_tukey["meandiff"], df_tukey["lower"], df_tukey["upper"], couleurs
    ):
        ax.errorbar(
            meandiff, y,
            xerr=[[meandiff - lo], [hi - meandiff]],
            fmt="o", color="black", ecolor=coul, elinewidth=2, capsize=3,
        )
    ax.axvline(0, color="black", linestyle="--", linewidth=1)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(df_tukey["comparaison"], fontsize=9)
    ax.set_xlabel("Différence de moyennes (nb d'AE essayés), IC 95% Tukey")
    ax.set_title("Post-hoc Tukey HSD — comparaisons par paire\n(rouge = significatif, gris = non significatif)")
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_forestplot_posthoc.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin




def graphique_welch_anova(df, F_welch, ddl1, ddl2, p_value,
                           groupe_col="groupe_crise", valeur_col="nb_ae_essayes",
                           dossier_sortie="."):
    
    stats_grp = df.groupby(groupe_col)[valeur_col].agg(n="count", moyenne="mean", ecart_type="std")
    stats_grp["sem"] = stats_grp["ecart_type"] / np.sqrt(stats_grp["n"])
    stats_grp = stats_grp.sort_values("moyenne", ascending=False)

    fig, ax = plt.subplots(figsize=(9, 6))
    x_pos = np.arange(len(stats_grp))
    ax.bar(x_pos, stats_grp["moyenne"], yerr=stats_grp["sem"], capsize=5,
           color="#6c8ebf", edgecolor="#2c3e50")
    for x, (moy, n) in enumerate(zip(stats_grp["moyenne"], stats_grp["n"])):
        ax.text(x, moy + 0.05, f"n={n}", ha="center", fontsize=8)

    ax.set_xticks(x_pos)
    ax.set_xticklabels(stats_grp.index, rotation=25, ha="right")
    ax.set_ylabel("Nombre moyen d'AE essayés (± SEM)")
    signif = "significatif" if p_value < 0.05 else "non significatif"
    ax.set_title(
        f"Welch-ANOVA : moyennes par groupe (variances non poolées)\n"
        f"F({ddl1}, {ddl2:.1f}) = {F_welch:.2f}, p = {p_value:.4f} -> {signif}"
    )
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_welch_anova_moyennes.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def graphique_kruskal_wallis(df, stat, p_value,
                              groupe_col="groupe_crise", valeur_col="nb_ae_essayes",
                              dossier_sortie="."):
    
    df_rangs = df[[groupe_col, valeur_col]].dropna().copy()
    df_rangs["rang"] = stats.rankdata(df_rangs[valeur_col])

    ordre = df_rangs.groupby(groupe_col)["rang"].median().sort_values(ascending=False).index
    data_par_groupe = [df_rangs.loc[df_rangs[groupe_col] == g, "rang"].values for g in ordre]

    fig, ax = plt.subplots(figsize=(10, 6))
    bp = ax.boxplot(data_par_groupe, labels=ordre, patch_artist=True, showmeans=True)
    for patch in bp["boxes"]:
        patch.set_facecolor("#f6c85f")

    rang_moyen_global = df_rangs["rang"].mean()
    ax.axhline(rang_moyen_global, color="#c0392b", linestyle="--", linewidth=1,
               label=f"rang moyen global = {rang_moyen_global:.1f}")

    ax.set_ylabel("Rang de nb_ae_essayes (toutes valeurs combinées)")
    ax.set_xlabel("Type de crise")
    signif = "différence significative" if p_value < 0.05 else "pas de différence significative"
    ax.set_title(f"Kruskal-Wallis : distribution des rangs par groupe\nH = {stat:.2f}, p = {p_value:.4f} -> {signif}")
    ax.legend(fontsize=8)
    plt.setp(ax.get_xticklabels(), rotation=25, ha="right")
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_kruskal_wallis_rangs.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def graphique_poisson_coefficients(modele, dossier_sortie="."):
    
    params = modele.params.drop("Intercept", errors="ignore")
    conf_int = modele.conf_int().drop("Intercept", errors="ignore")

    irr = np.exp(params)
    irr_low = np.exp(conf_int[0])
    irr_high = np.exp(conf_int[1])

    labels = [p.split("T.")[-1].rstrip("]") if "T." in p else p for p in params.index]

    ordre = np.argsort(irr.values)
    labels = [labels[i] for i in ordre]
    irr_v = irr.values[ordre]
    lo_v = irr_low.values[ordre]
    hi_v = irr_high.values[ordre]

    fig, ax = plt.subplots(figsize=(9, 0.6 * len(labels) + 2))
    y_pos = np.arange(len(labels))
    couleurs = ["#c0392b" if (lo > 1 or hi < 1) else "#7f8c8d" for lo, hi in zip(lo_v, hi_v)]

    for y, val, lo, hi, coul in zip(y_pos, irr_v, lo_v, hi_v, couleurs):
        ax.errorbar(val, y, xerr=[[val - lo], [hi - val]], fmt="o",
                    color="black", ecolor=coul, elinewidth=2, capsize=3)

    ax.axvline(1, color="black", linestyle="--", linewidth=1, label="référence (IRR=1)")
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=9)
    ax.set_xlabel("Incidence Rate Ratio (IRR) vs groupe de référence, IC 95%")
    ax.set_title("Régression de Poisson — effet du type de crise sur nb_ae_essayes\n"
                  "(rouge = IC95% excluant 1, gris = non significatif)")
    ax.legend(fontsize=8)
    fig.tight_layout()

    chemin = os.path.join(dossier_sortie, "epr_poisson_irr.png")
    fig.savefig(chemin, dpi=150)
    plt.close(fig)
    print(f"Graphique sauvegardé : {chemin}")
    return chemin


def generer_graphiques(df, tukey_result=None, groupe_col="groupe_crise",
                        valeur_col="nb_ae_essayes", dossier_sortie="."):
    print("\n" + "=" * 80)
    print("GÉNÉRATION DES GRAPHIQUES DESCRIPTIFS")
    print("=" * 80)
    chemins = {
        "boxplot": graphique_boxplot(df, groupe_col, valeur_col, dossier_sortie),
        "qqplots": graphique_qqplots(df, groupe_col, valeur_col, dossier_sortie),
        "histogrammes": graphique_histogrammes(df, groupe_col, valeur_col, dossier_sortie),
    }
    if tukey_result is not None:
        chemins["forest_posthoc"] = graphique_forest_posthoc(tukey_result, dossier_sortie)
    return chemins



def analyse_complete(conn=None, chemin_csv=None, dossier_sortie=".",
                      fichier_resultats="epr_resultats_type_crise.txt"):
    
    chemin_txt = os.path.join(dossier_sortie, fichier_resultats)
    chemins_graphiques = {}

    with open(chemin_txt, "w", encoding="utf-8") as f_out:
        tee = Tee(sys.stdout, f_out)
        with contextlib.redirect_stdout(tee):

            df = extraire_donnees(conn=conn, chemin_csv=chemin_csv)
            df = nettoyer_valeurs_manquantes(df)
            df = construire_groupe_crise(df)

            print("=" * 80)
            print("EFFECTIFS PAR GROUPE DE TYPE DE CRISE")
            print("=" * 80)
            print(df["groupe_crise"].value_counts())

            
            n_incertain = (df["groupe_crise"] == "Focale (sous-type non renseigné)").sum()
            if n_incertain > 0:
                print(f"\n{n_incertain} patient(s) exclus du test ANOVA : type focal avec "
                      f"sous_type non renseigné (impossible de vérifier la généralisation "
                      f"secondaire) -> à faire compléter par l'encadrante si possible.")
                df = df[df["groupe_crise"] != "Focale (sous-type non renseigné)"]

            df = filtrer_effectifs_faibles(df, n_min=5)

            print("\n" + "=" * 80)
            print("STATISTIQUES DESCRIPTIVES — nb_ae_essayes par groupe")
            print("=" * 80)
            print(descriptives(df))

            normalite_ok, variances_ok = verifier_hypotheses(df)

            print("\n" + "=" * 80)
            print("ANALYSE PRINCIPALE (demandée par l'encadrante) : ANOVA")
            print("=" * 80)
            modele, table_anova = anova_un_facteur(df)

            tukey_result = None
            if table_anova["PR(>F)"].iloc[0] < 0.05:
                tukey_result = posthoc_tukey(df)

            if not normalite_ok or not variances_ok:
                print("\n" + "=" * 80)
                print("ANOVA CLASSIQUE PEU FIABLE ICI (hypothèses violées) -> WELCH-ANOVA")
                print("=" * 80)
                F_welch, ddl1, ddl2, p_welch = welch_anova(df)
                chemins_graphiques["welch_anova"] = graphique_welch_anova(
                    df, F_welch, ddl1, ddl2, p_welch, dossier_sortie=dossier_sortie
                )

            print("\n" + "=" * 80)
            print("ANALYSES DE SENSIBILITÉ")
            print("=" * 80)
            stat_kw, p_kw = kruskal_wallis(df)
            chemins_graphiques["kruskal_wallis"] = graphique_kruskal_wallis(
                df, stat_kw, p_kw, dossier_sortie=dossier_sortie
            )

            modele_poisson = regression_poisson(df)
            chemins_graphiques["poisson_irr"] = graphique_poisson_coefficients(
                modele_poisson, dossier_sortie=dossier_sortie
            )

            chemins_graphiques.update(
                generer_graphiques(df, tukey_result=tukey_result, dossier_sortie=dossier_sortie)
            )

            print("\n" + "=" * 80)
            print("RÉCAPITULATIF DES FICHIERS GÉNÉRÉS")
            print("=" * 80)
            for nom, chemin in chemins_graphiques.items():
                print(f"  - {nom:20s} -> {chemin}")
            print(f"  - {'resultats_texte':20s} -> {chemin_txt}")

    print(f"\nRésultats texte complets sauvegardés dans : {chemin_txt}")

    return df, modele, table_anova, chemins_graphiques, chemin_txt


if __name__ == "__main__":
    
    print(__doc__)
    print("\nCe script attend soit une connexion PostgreSQL, soit un CSV exporté")
    print("via la requête SQL_QUERY définie en haut du fichier.")
    print("Prochaine étape suggérée : générer un jeu de données simulé (n=200) pour")
    print("tester ce script, comme pour test1/2/3_sep.py.")

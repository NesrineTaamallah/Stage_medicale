import sys
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.stats.outliers_influence import variance_inflation_factor
from scipy import stats
from scipy.stats import spearmanr
from sklearn.metrics import roc_curve, roc_auc_score, confusion_matrix
from sqlalchemy import create_engine, inspect, text

plt.rcParams["figure.dpi"] = 110


COVARIABLES_TEST1_AUTOTISEES = {
    "age_diagnostic_mois": {
        "table": "sep_identification_clinique",
        "colonne": "age_diagnostic_mois",
    },
    "sexe": {
        "table": "sep_identification_clinique",
        "colonne": "sexe",
    },
    "forme_evolutive": {
        "table": "sep_evolution",
        "colonne": "forme_evolutive",
    },
    "recuperation_complete": {
        "table": "sep_presentation_initiale",
        "colonne": "recuperation_complete",
    },
    "type_premier_evenement": {
        "table": "sep_presentation_initiale",
        "colonne": "type_premier_evenement",
    },
    "nb_lesions_t2_diagnostic": {
        "table": "sep_irm",
        "colonne": "nb_lesions_t2",
        
    },
    "consanguinite_parentale": {
        "table": "sep_antecedents",
        "colonne": "consanguinite_parentale",
    },
}


COLONNES_AVEC_NA_LITTERAL = {
    "recuperation_complete",
    "forme_evolutive",
}


def demander_connexion_postgres():
    print("=" * 70)
    print("CONNEXION A LA BASE DE DONNEES POSTGRESQL")
    print("=" * 70)
    host = input("Host (ex: localhost) : ").strip()
    port = input("Port (défaut 5432) : ").strip() or "5432"
    dbname = input("Nom de la base : ").strip()
    user = input("Utilisateur : ").strip()
    password = input("Mot de passe : ").strip()
    url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"
    engine = create_engine(url)
    with engine.connect():
        pass
    print("\n✅ Connexion réussie à la base.\n")
    return engine


def verifier_tables_requises(engine):
    insp = inspect(engine)
    tables_disponibles = set(insp.get_table_names())
    tables_requises = {
        "patients",
        "sep_identification_clinique",
        "sep_edss_visites",
        "sep_presentation_initiale",
        "sep_evolution",
        "sep_antecedents",
        "sep_irm",
    }
    manquantes = tables_requises - tables_disponibles
    if manquantes:
        print("\n❌ Tables requises absentes de la base :", ", ".join(sorted(manquantes)))
        print("   Ce script suppose le schema du registre SEP pediatrique tel que "
              "documente dans le dictionnaire de donnees v2. Verifiez la base "
              "connectee ou adaptez les noms de table ci-dessous.")
        sys.exit(1)
    print("✅ Toutes les tables requises du registre SEP sont présentes.\n")


def charger_donnees(engine):
    
    requete = text("""
        SELECT
            ic.pseudonyme,
            ic.delai_diagnostic_mois,
            ic.date_diagnostic,
            ic.age_diagnostic_mois,
            ic.age_premier_symptome_mois,
            ic.sexe,
            ev.forme_evolutive,
            pi.type_premier_evenement,
            pi.recuperation_complete,
            an.consanguinite_parentale
        FROM sep_identification_clinique ic
        JOIN patients p
            ON p.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_evolution ev
            ON ev.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_presentation_initiale pi
            ON pi.pseudonyme = ic.pseudonyme
        LEFT JOIN sep_antecedents an
            ON an.pseudonyme = ic.pseudonyme
        WHERE p.registre = 'SEP'
          AND ic.delai_diagnostic_mois IS NOT NULL
    """)
    df = pd.read_sql(requete, engine)
    df = df.rename(columns={"date_diagnostic": "date_ancrage_diagnostic"})

    for col in COLONNES_AVEC_NA_LITTERAL:
        if col in df.columns:
            n_na_litteral = (df[col] == "NA").sum()
            if n_na_litteral > 0:
                print(f"ℹ️ {n_na_litteral} valeur(s) 'NA' (non applicable) détectée(s) "
                      f"dans {col} → traitées comme manquantes, pas comme modalité.")
            df.loc[df[col] == "NA", col] = np.nan

    print(f"\n✅ Dataset patient-niveau construit par jointure")
    print(f"   {df.shape[0]} patients avec délai diagnostique renseigné, "
          f"{df.shape[1]} colonnes\n")
    return df


def extraire_edss_horizon(engine, pseudonymes, df_ancrage, horizon_annees, tolerance_mois=6):
   
    requete = text("""
        SELECT pseudonyme, date_visite, score_edss
        FROM sep_edss_visites
        WHERE pseudonyme = ANY(:pseudos)
          AND score_edss IS NOT NULL
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
    resultat = fusion[["pseudonyme", "score_edss", "date_visite", "ecart_jours"]].rename(
        columns={"score_edss": f"edss_a_{int(horizon_annees)}_ans"}
    )

    n_total = len(pseudonymes)
    n_trouve = len(resultat)
    print(f"\n📋 EDSS à {horizon_annees} an(s) (± {tolerance_mois} mois de tolérance) : "
          f"{n_trouve}/{n_total} patients ont une visite dans la fenêtre.")
    if n_total - n_trouve > 0:
        print(f"⚠️ {n_total - n_trouve} patient(s) exclu(s) faute de visite EDSS proche "
              f"de l'horizon demandé — vérifier un biais de perdus de vue "
              f"(sortie précoce du registre = souvent les cas les moins bien suivis).")
    return resultat


def extraire_nb_lesions_t2_diagnostic(engine, pseudonymes, df_ancrage, tolerance_mois=3):
    
    requete = text("""
        SELECT pseudonyme, date_examen, nb_lesions_t2
        FROM sep_irm
        WHERE pseudonyme = ANY(:pseudos)
          AND nb_lesions_t2 IS NOT NULL
    """)
    irms = pd.read_sql(requete, engine, params={"pseudos": list(pseudonymes)})
    irms["date_examen"] = pd.to_datetime(irms["date_examen"])

    d = df_ancrage[["pseudonyme", "date_ancrage_diagnostic"]].dropna().copy()
    d["date_ancrage_diagnostic"] = pd.to_datetime(d["date_ancrage_diagnostic"])

    fusion = irms.merge(d, on="pseudonyme", how="inner")
    fusion["ecart_jours"] = (fusion["date_examen"] - fusion["date_ancrage_diagnostic"]).dt.days.abs()
    fusion = fusion[fusion["ecart_jours"] <= tolerance_mois * 30.44]
    fusion = fusion.sort_values("ecart_jours").drop_duplicates("pseudonyme", keep="first")

    return fusion[["pseudonyme", "nb_lesions_t2"]].rename(
        columns={"nb_lesions_t2": "nb_lesions_t2_diagnostic"}
    )


def apercu_disponibilite_edss_horizon(engine, df, horizon_annees, fenetres_mois=(3, 6, 9, 12, 18, 24)):
    requete = text("""
        SELECT pseudonyme, date_visite, score_edss
        FROM sep_edss_visites
        WHERE pseudonyme = ANY(:pseudos)
          AND score_edss IS NOT NULL
    """)
    visites = pd.read_sql(requete, engine, params={"pseudos": list(df["pseudonyme"])})
    visites["date_visite"] = pd.to_datetime(visites["date_visite"])

    d = df[["pseudonyme", "date_ancrage_diagnostic"]].dropna().copy()
    d["date_ancrage_diagnostic"] = pd.to_datetime(d["date_ancrage_diagnostic"])
    d["date_cible"] = d["date_ancrage_diagnostic"] + pd.DateOffset(years=int(horizon_annees))

    fusion = visites.merge(d, on="pseudonyme", how="inner")
    fusion["ecart_jours"] = (fusion["date_visite"] - fusion["date_cible"]).dt.days.abs()

    n_total = len(df)
    n_avec_date_diagnostic = len(d)
    print("\n" + "=" * 70)
    print(f"DISPONIBILITÉ DES DONNÉES EDSS À {horizon_annees} AN(S)")
    print("=" * 70)
    print(f"Patients avec un délai diagnostique renseigné : {n_total}")
    print(f"Patients avec en plus une date de diagnostic renseignée : {n_avec_date_diagnostic}")
    print(f"\n{'#':<4}{'Fenêtre de tolérance':<25}{'Patients disponibles':<25}{'% du total':<10}")
    resultats = []
    for i, fenetre in enumerate(fenetres_mois):
        n_dispo = fusion[fusion["ecart_jours"] <= fenetre * 30.44]["pseudonyme"].nunique()
        pct = n_dispo / n_total * 100 if n_total else 0
        print(f"[{i}] {'± ' + str(fenetre) + ' mois':<22}{n_dispo}/{n_total}{'':<15}{pct:.1f}%")
        resultats.append(fenetre)
    print()
    return resultats


def menu_choix_clinicien(engine, df):
    print("\n" + "=" * 70)
    print("CONFIGURATION DE L'ANALYSE")
    print("=" * 70)

    print("\nType de régression :")
    print("  [1] Linéaire   (EDSS traité comme variable continue)")
    print("  [2] Logistique (EDSS binarisé selon un seuil : bon/mauvais pronostic)")
    type_regression = input("Choix : ").strip()
    type_regression = "linear" if type_regression == "1" else "logistic"

    print("\nÀ quel horizon de suivi est mesuré l'EDSS utilisé comme variable à expliquer ?")
    print("  [1] EDSS à 2 ans")
    print("  [2] EDSS à 3 ans")
    print("  [3] EDSS à 4 ans")
    print("  [4] Autre horizon (en années entières)")
    choix_horizon = input("Choix : ").strip()
    horizons = {"1": 2, "2": 3, "3": 4}
    if choix_horizon in horizons:
        horizon_annees = horizons[choix_horizon]
    else:
        horizon_annees = int(input("Précisez l'horizon en années entières (ex: 5) : ").strip() or "3")
    horizon_edss = f"{horizon_annees} ans"

    fenetres_mois = apercu_disponibilite_edss_horizon(engine, df, horizon_annees)

    print("Choisissez la fenêtre de tolérance parmi celles du tableau ci-dessus :")
    choix_fenetre = input("Numéro de fenêtre [0-{}] : ".format(len(fenetres_mois) - 1)).strip()
    if choix_fenetre.isdigit() and 0 <= int(choix_fenetre) < len(fenetres_mois):
        tolerance_mois = fenetres_mois[int(choix_fenetre)]
    else:
        tolerance_mois = fenetres_mois[1]

    col_edss = f"edss_a_{horizon_annees}_ans"

    seuils_classiques = [3.0, 4.0, 6.0]
    seuil_logistique = None
    if type_regression == "logistic":
        print("\nSeuil EDSS pour définir 'mauvais pronostic' (classiquement 3.0, 4.0 ou 6.0) :")
        seuil_logistique = float(input("Seuil EDSS (ex: 3.0) : ").strip())
        if seuil_logistique not in seuils_classiques:
            print(f"⚠️ Seuil {seuil_logistique} non standard (usuels : {seuils_classiques}).")
            confirmer = input("   Confirmez-vous ce choix ? (o/n, défaut=o) : ").strip().lower()
            if confirmer == "n":
                seuil_logistique = float(input("   Nouveau seuil EDSS : ").strip())

    print("\nAnalyse :")
    print("  [1] Univariée   (délai seul)")
    print("  [2] Multivariée (délai + covariables ajustées)")
    mode_var = input("Choix : ").strip()

    covariables = []
    if mode_var == "2":
        
        noms = list(COVARIABLES_TEST1_AUTOTISEES.keys())
        print("\nCovariables d'ajustement disponibles :")
        for i, nom in enumerate(noms):
            table = COVARIABLES_TEST1_AUTOTISEES[nom]["table"]
            print(f"  [{i}] {nom} (table : {table})")
        print("  Entrez les numéros séparés par des virgules (ex: 0,2,4)")
        choix = input("Votre sélection : ").strip()
        if choix:
            indices = [int(x) for x in choix.split(",") if x.strip().isdigit()]
            covariables = [noms[i] for i in indices if 0 <= i < len(noms)]

    return {
        "type_regression": type_regression,
        "col_edss": col_edss,
        "horizon_edss": horizon_edss,
        "horizon_annees": horizon_annees,
        "tolerance_mois": tolerance_mois,
        "seuil_logistique": seuil_logistique,
        "covariables": covariables,
    }


def preparer_dataset_modele(df, config):
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
    n_apres = len(d)
    n_exclus = n_avant - n_apres
    print(f"\n📋 Effectif avant exclusion des valeurs manquantes : n = {n_avant}")
    if n_exclus > 0:
        print(f"⚠️ {n_exclus} patient(s) exclu(s) pour donnée(s) manquante(s) "
              f"({n_exclus / n_avant * 100:.1f}%) — vérifier un éventuel biais de sélection.")
    print(f"📋 Effectif final utilisé pour le modèle : n = {n_apres}\n")

    if config["type_regression"] == "logistic":
        d["_outcome"] = (d[config["col_edss"]] >= config["seuil_logistique"]).astype(int)
    else:
        d["_outcome"] = d[config["col_edss"]]

    return d


def construire_formule(d, config):
    predicteurs = ["_delai_mois"] + [
        c for c in d.columns if c not in ["_delai_mois", config["col_edss"], "_outcome"]
    ]
    formule = "_outcome ~ " + " + ".join(predicteurs)
    return formule, predicteurs


def verifier_prerequis(d, predicteurs, config):
    print("\n" + "=" * 70)
    print("VERIFICATION DES PREREQUIS")
    print("=" * 70)

    n = len(d)
    print(f"Effectif utilisable (après suppression des valeurs manquantes) : n = {n}")

    if config["type_regression"] == "linear" and n < 10 * (len(predicteurs) + 1):
        print("⚠️ Règle empirique (10 obs/variable) non respectée : risque de surajustement.")

    if config["type_regression"] == "logistic":
        n_evenements = d["_outcome"].sum()
        print(f"Nombre d'événements ('mauvais pronostic') : {n_evenements} / {n}")
        epp = n_evenements / max(len(predicteurs), 1)
        print(f"Événements par prédicteur (EPV) : {epp:.1f} (règle classique : ≥ 10)")
        if epp < 10:
            print("⚠️ EPV < 10 : les estimations d'OR peuvent être instables.")

    if len(predicteurs) > 1:
       
        X = d[predicteurs].astype(float).copy()
        X = sm.add_constant(X)
        vifs = pd.Series(
            [variance_inflation_factor(X.values, i) for i in range(X.shape[1])],
            index=X.columns,
        )
        print("\nFacteurs d'inflation de variance (VIF) :")
        print(vifs.drop("const").round(2).to_string())
        if (vifs.drop("const") > 5).any():
            print("⚠️ VIF > 5 détecté : forte colinéarité entre certaines covariables.")
            print("   → Envisager de retirer ou regrouper les covariables concernées.")

        predicteurs_dummies = [p for p in predicteurs if "_" in p and p not in ["_delai_mois"]]
        if predicteurs_dummies:
            print("ℹ️ Note méthodologique : certains prédicteurs sont des indicatrices (dummies) "
                  "issues de variables catégorielles. Le VIF peut être artificiellement élevé "
                  "si une catégorie a un faible effectif — interpréter avec prudence, ne pas "
                  "se fier au VIF seul pour ces variables (vérifier aussi les effectifs par "
                  "catégorie).")


def afficher_spearman(d, config):
    print("\n" + "=" * 70)
    print("CORRELATION DE SPEARMAN (relation brute, non ajustée)")
    print("=" * 70)
    rho, p_spearman = spearmanr(d["_delai_mois"], d[config["col_edss"]])
    print(f"Délai diagnostique (mois) vs {config['col_edss']} (horizon : {config.get('horizon_edss', 'NA')})")
    print(f"  ρ (Spearman) = {rho:.3f}  |  p = {p_spearman:.4f}")
    if p_spearman < 0.05:
        sens = "positive (délai plus long → EDSS plus élevé)" if rho > 0 else "négative"
        print(f"  => Corrélation monotone significative, de tendance {sens}.")
    else:
        print("  => Pas de corrélation monotone significative détectée (relation brute).")
    print("  Note : à comparer avec l'effet ajusté (β ou OR) du modèle multivarié ci-dessous ; "
          "Spearman est adapté à l'EDSS car cette échelle est ordinale et la relation "
          "délai→EDSS n'est pas nécessairement linéaire.")
    return rho, p_spearman


def ajuster_modele(d, formule, config):
    afficher_spearman(d, config)

    print("\n" + "=" * 70)
    print("RESULTATS DU MODELE")
    print("=" * 70)

    if config["type_regression"] == "linear":
        modele = smf.ols(formule, data=d).fit()
        print(modele.summary())

        print("\n--- Interprétation clinique ---")
        beta = modele.params["_delai_mois"]
        pval = modele.pvalues["_delai_mois"]
        ci = modele.conf_int().loc["_delai_mois"]
        print(f"β (délai) = {beta:.4f}  |  IC95% [{ci[0]:.4f} ; {ci[1]:.4f}]  |  p = {pval:.4f}")
        horizon_txt = config.get("horizon_edss") or "l'horizon étudié"
        print(f"=> Chaque mois de délai supplémentaire est associé à une variation de "
              f"{beta:.3f} point d'EDSS à {horizon_txt} "
              f"(toutes covariables égales par ailleurs).")

    else:
        try:
            modele = smf.logit(formule, data=d).fit(disp=0, maxiter=100)
        except np.linalg.LinAlgError:
            print("⚠️ Matrice singulière détectée (séparation quasi-complète) "
                  "→ basculement vers un ajustement avec régularisation L1.")
            print("   Les OR des covariables avec catégories rares peuvent être "
                  "instables ou non identifiables — interpréter avec prudence.")
            modele = smf.logit(formule, data=d).fit_regularized(
                disp=0, method="l1", maxiter=200
            )
        print(modele.summary())

        print("\n--- Odds Ratios (interprétation clinique) ---")
        or_table = pd.DataFrame({
            "OR": np.exp(modele.params),
            "IC95%_bas": np.exp(modele.conf_int()[0]),
            "IC95%_haut": np.exp(modele.conf_int()[1]),
            "p": modele.pvalues,
        })
        print(or_table.round(4).to_string())

        or_delai = or_table.loc["_delai_mois", "OR"]
        p_delai = or_table.loc["_delai_mois", "p"]
        print(f"\n=> OR (délai) = {or_delai:.3f} : chaque mois de délai supplémentaire "
              f"multiplie le risque de mauvais pronostic (EDSS ≥ {config['seuil_logistique']}) "
              f"par {or_delai:.3f} (p={p_delai:.4f}).")

    return modele


def graphiques_regression_lineaire(d, modele, config):
    fig, axes = plt.subplots(2, 2, figsize=(12, 9))

    axes[0, 0].scatter(d["_delai_mois"], d["_outcome"], alpha=0.6, edgecolor="k")
    x_range = np.linspace(d["_delai_mois"].min(), d["_delai_mois"].max(), 100)
    pred_df = pd.DataFrame({"_delai_mois": x_range})
   
    for col in d.columns:
        if col not in ["_delai_mois", "_outcome", config["col_edss"]]:
            vals = d[col].dropna().unique()
            if set(vals).issubset({0.0, 1.0, 0, 1}):
                pred_df[col] = float(d[col].mode().iloc[0])
            else:
                pred_df[col] = float(d[col].mean())
    y_pred = modele.predict(pred_df)
    axes[0, 0].plot(x_range, y_pred, color="red", lw=2, label="droite de régression")
    axes[0, 0].set_xlabel("Délai diagnostique (mois)")
    axes[0, 0].set_ylabel(f"{config['col_edss']}")
    horizon_txt = config.get("horizon_edss") or "l'horizon étudié"
    axes[0, 0].set_title(f"Délai diagnostique vs EDSS à {horizon_txt}")
    axes[0, 0].legend()

    axes[0, 1].scatter(modele.fittedvalues, modele.resid, alpha=0.6, edgecolor="k")
    axes[0, 1].axhline(0, color="red", linestyle="--")
    axes[0, 1].set_xlabel("Valeurs ajustées")
    axes[0, 1].set_ylabel("Résidus")
    axes[0, 1].set_title("Résidus vs valeurs ajustées")

    sm.qqplot(modele.resid, line="s", ax=axes[1, 0])
    axes[1, 0].set_title("QQ-plot des résidus (normalité)")

    axes[1, 1].hist(modele.resid, bins=20, edgecolor="k")
    axes[1, 1].set_title("Distribution des résidus")

    plt.tight_layout()
    output_dir = os.environ.get("SEP_OUTPUT_DIR", "/mnt/user-data/outputs")
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, "test1_regression_lineaire.png")
    plt.savefig(filepath, dpi=110, bbox_inches="tight")
    plt.show()
    plt.close(fig)
    print(f"\n📊 Graphiques sauvegardés : {filepath}")

    stat, p_shapiro = stats.shapiro(modele.resid)
    print(f"\nTest de Shapiro-Wilk (normalité résidus) : W={stat:.4f}, p={p_shapiro:.4f}")
    if p_shapiro < 0.05:
        print("⚠️ Résidus non normaux (p<0.05) — envisager transformation ou modèle robuste.")
    n_resid = len(modele.resid)
    if n_resid < 50:
        print(f"ℹ️ Note méthodologique : n = {n_resid} (échantillon pédiatrique probablement limité). "
              "Le test de Shapiro-Wilk a une puissance réduite avec un petit effectif : une "
              "normalité non rejetée (p≥0.05) ne garantit pas l'absence de déviation, et à "
              "l'inverse un rejet peut être dû au bruit. Inspecter aussi visuellement le "
              "QQ-plot et l'histogramme des résidus avant de conclure.")
    elif n_resid > 5000:
        print(f"ℹ️ Note méthodologique : n = {n_resid} (grand échantillon). "
              "Le test de Shapiro-Wilk est très sensible avec un grand effectif : un rejet "
              "(p<0.05) ne signifie pas nécessairement que la normalité est gravement violée. "
              "Inspecter visuellement le QQ-plot et l'histogramme des résidus.")


def graphiques_regression_logistique(d, modele, config):
    fig, axes = plt.subplots(2, 2, figsize=(12, 9))

    x_range = np.linspace(d["_delai_mois"].min(), d["_delai_mois"].max(), 100)
    pred_df = pd.DataFrame({"_delai_mois": x_range})
    
    for col in d.columns:
        if col not in ["_delai_mois", "_outcome", config["col_edss"]]:
            vals = d[col].dropna().unique()
            if set(vals).issubset({0.0, 1.0, 0, 1}):
                pred_df[col] = float(d[col].mode().iloc[0])
            else:
                pred_df[col] = float(d[col].mean())
    proba = modele.predict(pred_df)

    axes[0, 0].scatter(d["_delai_mois"], d["_outcome"], alpha=0.4, edgecolor="k", label="observations")
    axes[0, 0].plot(x_range, proba, color="red", lw=2, label="probabilité prédite")
    axes[0, 0].set_xlabel("Délai diagnostique (mois)")
    axes[0, 0].set_ylabel(f"P(EDSS ≥ {config['seuil_logistique']})")
    axes[0, 0].set_title("Courbe logistique : délai vs probabilité de mauvais pronostic")
    axes[0, 0].legend()

    y_true = d["_outcome"]
    y_score = modele.predict(d)
    fpr, tpr, _ = roc_curve(y_true, y_score)
    auc = roc_auc_score(y_true, y_score)
    axes[0, 1].plot(fpr, tpr, color="darkorange", lw=2, label=f"AUC = {auc:.3f}")
    axes[0, 1].plot([0, 1], [0, 1], linestyle="--", color="grey")
    axes[0, 1].set_xlabel("1 - Spécificité (FPR)")
    axes[0, 1].set_ylabel("Sensibilité (TPR)")
    axes[0, 1].set_title("Courbe ROC")
    axes[0, 1].legend()

    or_table = pd.DataFrame({
        "OR": np.exp(modele.params),
        "bas": np.exp(modele.conf_int()[0]),
        "haut": np.exp(modele.conf_int()[1]),
    }).drop("Intercept", errors="ignore")
    axes[1, 0].errorbar(
        or_table["OR"], range(len(or_table)),
        xerr=[or_table["OR"] - or_table["bas"], or_table["haut"] - or_table["OR"]],
        fmt="o", color="black", ecolor="steelblue", capsize=4,
    )
    axes[1, 0].axvline(1, color="red", linestyle="--")
    axes[1, 0].set_yticks(range(len(or_table)))
    axes[1, 0].set_yticklabels(or_table.index)
    axes[1, 0].set_xlabel("Odds Ratio (IC95%)")
    axes[1, 0].set_title("Forest plot des OR")

    y_pred_class = (y_score >= 0.5).astype(int)
    cm = confusion_matrix(y_true, y_pred_class)
    axes[1, 1].imshow(cm, cmap="Blues")
    for i in range(2):
        for j in range(2):
            axes[1, 1].text(j, i, cm[i, j], ha="center", va="center", fontsize=14)
    axes[1, 1].set_xticks([0, 1]); axes[1, 1].set_xticklabels(["Prédit: bon", "Prédit: mauvais"])
    axes[1, 1].set_yticks([0, 1]); axes[1, 1].set_yticklabels(["Réel: bon", "Réel: mauvais"])
    axes[1, 1].set_title("Matrice de confusion (seuil 0.5)")

    plt.tight_layout()
    output_dir = os.environ.get("SEP_OUTPUT_DIR", "/mnt/user-data/outputs")
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, "test1_regression_logistique.png")
    plt.savefig(filepath, dpi=110, bbox_inches="tight")
    plt.show()
    plt.close(fig)
    print(f"\n📊 Graphiques sauvegardés : {filepath}")
    print(f"AUC (aire sous la courbe ROC) : {auc:.3f}")


def main():
    print("=" * 70)
    print("Délai diagnostique et pronostic (EDSS) - Registre SEP pédiatrique")
    print("=" * 70)

    engine = demander_connexion_postgres()
    verifier_tables_requises(engine)
    df = charger_donnees(engine)

    config = menu_choix_clinicien(engine, df)

    
    edss_horizon = extraire_edss_horizon(
        engine, df["pseudonyme"], df, config["horizon_annees"], config["tolerance_mois"]
    )
    df = df.merge(edss_horizon[["pseudonyme", config["col_edss"]]], on="pseudonyme", how="left")

    
    if "nb_lesions_t2_diagnostic" in config["covariables"]:
        irm_diag = extraire_nb_lesions_t2_diagnostic(engine, df["pseudonyme"], df)
        df = df.merge(irm_diag, on="pseudonyme", how="left")

    d = preparer_dataset_modele(df, config)
    formule, predicteurs = construire_formule(d, config)
    print(f"\nFormule du modèle : {formule}")

    verifier_prerequis(d, predicteurs, config)
    modele = ajuster_modele(d, formule, config)

    if config["type_regression"] == "linear":
        graphiques_regression_lineaire(d, modele, config)
    else:
        graphiques_regression_logistique(d, modele, config)

    print("\n✅ Analyse terminée.")


if __name__ == "__main__":
    main()
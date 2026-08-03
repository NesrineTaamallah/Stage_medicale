import warnings
import os
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
import matplotlib.pyplot as plt
from scipy import stats
from sqlalchemy import create_engine

warnings.filterwarnings("ignore", category=UserWarning)

def obtenir_moteur_postgres():
    url = (
        f"postgresql+psycopg2://{os.environ.get('PGUSER', 'postgres')}:"
        f"{os.environ.get('PGPASSWORD', '')}@"
        f"{os.environ.get('PGHOST', 'localhost')}:"
        f"{os.environ.get('PGPORT', '5432')}/"
        f"{os.environ.get('PGDATABASE', 'cdr_neuroexo')}"
    )
    return create_engine(url)
FENETRES_TAP_LITTERATURE = {
    "2": (2.0, "2 premieres annees - fenetre retenue par defaut."),
    "1": (1.0, "1 an - fenetre courte, plus stricte (analyse de sensibilite)."),
    "5": (5.0, "5 premieres annees - fenetre alternative, suivi plus long."),
    "3": (3.0, "3 ans - option libre, a utiliser avec prudence."),
}
FENETRE_TAP_DEFAUT_ANNEES = 2.0
EXPOSITION_MIN_ANNEES = 0.5        
FENETRE_POST_POUSSEE_DEFAUT_MOIS = 3
MIN_PATIENTS_ALERTE = 15
MIN_POINTS_ALERTE = 30
MIN_VISITS_FOR_RANDOM_SLOPE = 3
SEUIL_DISPERSION_ALERTE = 1.5      
EPSILON_TIME = 1e-3

COVARIABLES_TAP_AUTORISEES = {
    "age_onset": {
        
        "colonne_attendue": "age_onset_annees",
        "source": "Age au premier symptome.",
    },
    "sexe": {
        "colonne_attendue": "sexe",
        "source": "Sexe du patient.",
    },
    "edss_inclusion": {
        
        "colonne_attendue": "edss_inclusion",
        "source": "EDSS a l'inclusion.",
    },
}

def charger_onset_patients(engine) -> pd.DataFrame:
    
    requete = """
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
    """
    df = pd.read_sql(requete, engine)
    df["date_onset"] = pd.to_datetime(df["date_onset"])

    n_total_requete = pd.read_sql(
        "SELECT COUNT(*) AS n FROM sep_identification_clinique", engine
    )["n"].iloc[0]
    n_exclus = n_total_requete - len(df)
    if n_exclus > 0:
        print(f"  [EXCLUSION - donnees manquantes] {n_exclus}/{n_total_requete} "
              f"patient(s) exclu(s) de la reconstruction de date_onset : "
              f"date_diagnostic, delai_diagnostic_mois ou "
              f"age_premier_symptome_mois non renseigne(s) (NULL) dans "
              f"sep_identification_clinique. A distinguer d'une valeur 'NA' "
              f"(non applicable) : ici il s'agit de donnees non encore "
              f"collectees, pas de champs sans objet pour ces patients.")
    return df


def charger_edss_inclusion(engine) -> pd.DataFrame:
    
    requete = """
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
    """
    df = pd.read_sql(requete, engine)

    n_patients = pd.read_sql("SELECT COUNT(*) AS n FROM patients", engine)["n"].iloc[0]
    n_sans_edss_inclusion = n_patients - len(df)
    if n_sans_edss_inclusion > 0:
        print(f"  [EXCLUSION - donnees manquantes] {n_sans_edss_inclusion}/"
              f"{n_patients} patient(s) sans edss_inclusion calculable "
              f"(date_inclusion non renseignee, ou aucune visite EDSS avec "
              f"score_edss non-NULL a/apres la date d'inclusion). Ces "
              f"patients restent utilisables pour le TAP/EDSS(t), mais sans "
              f"la covariable edss_inclusion (NaN -> exclue du modele "
              f"ajuste si cette covariable est selectionnee).")
    return df


def charger_covariables_patients(engine) -> pd.DataFrame:
    
    onset = charger_onset_patients(engine)
    edss_incl = charger_edss_inclusion(engine)
    return onset.merge(edss_incl, on="patient_id", how="left")


def charger_edss(engine) -> pd.DataFrame:
    
    requete = """
        SELECT
            pseudonyme AS patient_id,
            date_visite,
            score_edss AS edss
        FROM sep_edss_visites
        WHERE date_visite IS NOT NULL
          AND score_edss IS NOT NULL
        ORDER BY pseudonyme, date_visite
    """
    df = pd.read_sql(requete, engine, parse_dates=["date_visite"])
    n_visites_brutes = pd.read_sql(
        "SELECT COUNT(*) AS n FROM sep_edss_visites", engine
    )["n"].iloc[0]
    n_visites_exclues = n_visites_brutes - len(df)
    if n_visites_exclues > 0:
        print(f"  [EXCLUSION - donnees manquantes] {n_visites_exclues}/"
              f"{n_visites_brutes} ligne(s) de sep_edss_visites exclue(s) : "
              f"date_visite ou score_edss non renseigne (NULL).")

    onset = charger_onset_patients(engine)[["patient_id", "date_onset"]]
    n_avant_jointure = df["patient_id"].nunique()
    df = df.merge(onset, on="patient_id", how="inner")
    n_apres_jointure = df["patient_id"].nunique()
    if n_apres_jointure < n_avant_jointure:
        print(f"  [EXCLUSION - donnees manquantes] "
              f"{n_avant_jointure - n_apres_jointure} patient(s) avec des "
              f"visites EDSS mais sans date_onset reconstructible -- "
              f"exclus (jointure INNER) plutot que laisses en NaT, pour "
              f"eviter toute propagation silencieuse vers le calcul de la "
              f"fenetre TAP et du temps depuis l'onset.")

    requis = {"patient_id", "date_onset", "date_visite", "edss"}
    manquantes = requis - set(df.columns)
    if manquantes:
        raise ValueError(f"Colonnes manquantes apres chargement EDSS : {manquantes}")
    return df


def charger_poussees(engine) -> pd.DataFrame:
    
    requete = """
        SELECT
            pseudonyme AS patient_id,
            date_poussee
        FROM sep_poussees
        WHERE date_poussee IS NOT NULL
        ORDER BY pseudonyme, date_poussee
    """
    df = pd.read_sql(requete, engine, parse_dates=["date_poussee"])
    n_poussees_brutes = pd.read_sql(
        "SELECT COUNT(*) AS n FROM sep_poussees", engine
    )["n"].iloc[0]
    n_exclues = n_poussees_brutes - len(df)
    if n_exclues > 0:
        print(f"  [EXCLUSION - donnees manquantes] {n_exclues}/"
              f"{n_poussees_brutes} poussee(s) exclue(s) : date_poussee "
              f"non renseignee (NULL) dans sep_poussees.")

    requis = {"patient_id", "date_poussee"}
    manquantes = requis - set(df.columns)
    if manquantes:
        raise ValueError(f"Colonnes manquantes apres chargement poussees : {manquantes}")
    return df


def choisir_fenetre_tap() -> float:
    print("\n" + "=" * 70)
    print("FENETRE DE CALCUL DU TAP PRECOCE")
    print("=" * 70)
    print(f"Fenetre par defaut : {FENETRE_TAP_DEFAUT_ANNEES:.0f} an(s). "
          f"Appuyez sur Entree pour la retenir, ou choisissez une autre "
          f"duree pour une analyse de sensibilite.")
    for cle, (valeur, ref) in FENETRES_TAP_LITTERATURE.items():
        print(f"  [{cle}] {valeur:.0f} an(s) - {ref}")
    print("  [autre] saisir une valeur libre (annees)")
    choix = input(f"Choix (Entree = {FENETRE_TAP_DEFAUT_ANNEES:.0f} an(s)) : ").strip()
    if not choix:
        fenetre = FENETRE_TAP_DEFAUT_ANNEES
    elif choix in FENETRES_TAP_LITTERATURE:
        fenetre = FENETRES_TAP_LITTERATURE[choix][0]
    else:
        try:
            fenetre = float(choix)
        except ValueError:
            print(f"  Valeur non reconnue, fenetre par defaut retenue : "
                  f"{FENETRE_TAP_DEFAUT_ANNEES} ans.")
            fenetre = FENETRE_TAP_DEFAUT_ANNEES
    print(f"\n-> Fenetre retenue pour le TAP precoce : {fenetre:.1f} an(s).")
    if fenetre != FENETRE_TAP_DEFAUT_ANNEES:
        print(f"  [ECART] Fenetre de {fenetre:.1f} an(s) au lieu du defaut "
              f"({FENETRE_TAP_DEFAUT_ANNEES:.0f} an(s)) -- a presenter en "
              f"complement, pas en remplacement.")
    if fenetre not in [v for v, _ in FENETRES_TAP_LITTERATURE.values()]:
        print("  Note : fenetre non standard (1, 2, 3 ou 5 ans).")
    return fenetre


def calculer_tap_par_patient(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                              fenetre_annees: float) -> pd.DataFrame:

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
            "patient_id": pid,
            "date_onset": date_onset,
            "exposition_annees": exposition_annees,
            "n_poussees_fenetre": n_poussees,
            "censure_avant_fin_fenetre": date_fin_suivi_reelle < date_fin_fenetre,
        })

    tap = pd.DataFrame(lignes)

    n_avant = len(tap)
    tap_exclus = tap[tap["exposition_annees"] < EXPOSITION_MIN_ANNEES]
    tap = tap[tap["exposition_annees"] >= EXPOSITION_MIN_ANNEES].copy()
    if len(tap_exclus) > 0:
        print(f"\n[EXCLUSION] {len(tap_exclus)} patient(s) exclu(s) du calcul "
              f"du TAP : exposition < {EXPOSITION_MIN_ANNEES} an "
              f"(estimation du TAP non fiable sur un suivi trop court).")

    tap["tap_empirique"] = tap["n_poussees_fenetre"] / tap["exposition_annees"]

    n_censures = tap["censure_avant_fin_fenetre"].sum()
    print(f"\nTAP precoce calcule sur {len(tap)}/{n_avant} patients "
          f"(fenetre = {fenetre_annees:.1f} an(s)).")
    if n_censures > 0:
        print(f"  {n_censures} patient(s) suivi(s) moins longtemps que la "
              f"fenetre choisie (exposition partielle, prise en compte via "
              f"l'offset dans les modeles GLM ; le TAP empirique de ces "
              f"patients reste une estimation moins precise -- a mentionner "
              f"si le rapport les met en avant individuellement).")

    return tap

def choisir_covariables_tap(df_tap: pd.DataFrame) -> list:
    print("\nSouhaitez-vous ajuster le modele de comptage (Poisson/Binomiale "
          "Negative) sur des covariables, ou estimer le TAP moyen de "
          "population sans ajustement ?")
    print("  [1] Aucune covariable (intercept seul - TAP moyen de population)")
    print("  [2] Ajuster sur des covariables")
    choix = input("Choix : ").strip()
    if choix != "2":
        return []

    print("\nCovariables disponibles (sourcees) :")
    cles = list(COVARIABLES_TAP_AUTORISEES.keys())
    for i, c in enumerate(cles):
        print(f"  [{i}] {c} -- {COVARIABLES_TAP_AUTORISEES[c]['source']}")
    print("  Entrez les numeros separes par des virgules (ex: 0,1), ou "
          "Entree pour aucune.")
    saisie = input("Votre selection : ").strip()
    if not saisie:
        return []
    indices = [int(x) for x in saisie.split(",") if x.strip().isdigit()]
    selection = [cles[i] for i in indices if 0 <= i < len(cles)]

    colonnes = []
    for v in selection:
        col = COVARIABLES_TAP_AUTORISEES[v]["colonne_attendue"]
        if col not in df_tap.columns:
            print(f"  [IGNOREE] '{v}' demandee mais colonne '{col}' absente "
                  f"des donnees fournies.")
            continue
        colonnes.append(col)
    return colonnes


def ajuster_poisson(df_tap: pd.DataFrame, covariables: list):
    formule = "n_poussees_fenetre ~ " + (" + ".join(covariables) if covariables else "1")
    modele = smf.glm(
        formule, data=df_tap, family=sm.families.Poisson(),
        exposure=df_tap["exposition_annees"],
    )
    return modele.fit()


def ajuster_binomiale_negative(df_tap: pd.DataFrame, covariables: list):
    formule = "n_poussees_fenetre ~ " + (" + ".join(covariables) if covariables else "1")
    modele = smf.negativebinomial(
        formule, data=df_tap, exposure=df_tap["exposition_annees"],
    )
    return modele.fit(disp=0)


def test_surdispersion(resultat_poisson, df_tap: pd.DataFrame) -> dict:
    
    y = df_tap["n_poussees_fenetre"].values
    mu = resultat_poisson.fittedvalues.values
    g = ((y - mu) ** 2 - y) / mu
    aux = sm.OLS(g, mu).fit()
    coef = aux.params[0]
    p_value = aux.pvalues[0]

    residus_pearson = (y - mu) / np.sqrt(mu)
    ddl = len(y) - len(resultat_poisson.params)
    dispersion_pearson = float(np.sum(residus_pearson ** 2) / ddl) if ddl > 0 else np.nan

    return {
        "coef_auxiliaire": coef,
        "p_value": p_value,
        "surdispersion_significative": (coef > 0) and (p_value < 0.05),
        "dispersion_pearson_chi2_ddl": dispersion_pearson,
    }


def tap_ajuste_avec_ic(resultat, expo_reference: float = 1.0) -> tuple:
    pred = resultat.get_prediction()
    resume = pred.summary_frame(alpha=0.05)
    tap_moyen = resume["mean"].mean()
    ic_bas = resume["mean_ci_lower"].mean()
    ic_haut = resume["mean_ci_upper"].mean()
    return tap_moyen, ic_bas, ic_haut


def comparer_poisson_nb(df_tap: pd.DataFrame, covariables: list) -> dict:
    print("\n" + "=" * 70)
    print("ETAPE 1b : TAP precoce -- comparaison Poisson vs Binomiale Negative")
    print("=" * 70)
    print("(offset = log(exposition en annees), covariables = "
          f"{covariables if covariables else 'aucune'})")

    res_poisson = ajuster_poisson(df_tap, covariables)
    res_nb = ajuster_binomiale_negative(df_tap, covariables)

    disp = test_surdispersion(res_poisson, df_tap)

    tap_p, ic_p_bas, ic_p_haut = tap_ajuste_avec_ic(res_poisson)
    tap_nb_moyen = np.exp(res_nb.predict(df_tap, exposure=np.ones(len(df_tap)))).mean()

    print("\n--- Test de surdispersion ---")
    print(f"  Coefficient auxiliaire = {disp['coef_auxiliaire']:.3f}  |  "
          f"p = {disp['p_value']:.4f}")
    print(f"  Ratio de dispersion de Pearson (chi2/ddl) = "
          f"{disp['dispersion_pearson_chi2_ddl']:.2f} "
          f"(reference Poisson = 1.0 ; > {SEUIL_DISPERSION_ALERTE} = "
          f"indicateur usuel de surdispersion)")
    if disp["surdispersion_significative"] or disp["dispersion_pearson_chi2_ddl"] > SEUIL_DISPERSION_ALERTE:
        print("  => Surdispersion detectee : la Binomiale Negative est "
              "recommandee.")
        recommandation = "nb"
    else:
        print("  => Pas de surdispersion marquee : le Poisson est "
              "statistiquement defendable ici (situation moins frequente "
              "en pratique pour des comptes de poussees, a confirmer avec "
              "les autres criteres ci-dessous).")
        recommandation = "poisson"

    print("\n--- Comparaison des ajustements ---")
    tableau = pd.DataFrame({
        "Modele": ["Poisson", "Binomiale Negative"],
        "AIC": [res_poisson.aic, res_nb.aic],
        "BIC": [res_poisson.bic, res_nb.bic],
        "LogLik": [res_poisson.llf, res_nb.llf],
        "alpha (NB)": [np.nan, res_nb.params.get("alpha", np.nan)],
        "TAP ajuste (n/an)": [tap_p, tap_nb_moyen],
    })
    print(tableau.round(3).to_string(index=False))
    print(f"\n  TAP ajuste (Poisson), IC95% : [{ic_p_bas:.3f} ; {ic_p_haut:.3f}] "
          f"poussees/an.")
    print(f"  (Le modele avec l'AIC le plus bas decrit mieux les donnees ; "
          f"a interpreter avec le test de surdispersion ci-dessus, pas "
          f"seul.)")

    meilleur_aic = "nb" if res_nb.aic < res_poisson.aic else "poisson"
    print(f"\n  Modele recommande (surdispersion + AIC) : "
          f"{'Binomiale Negative' if recommandation == 'nb' else 'Poisson'}"
          f"{' (concorde avec le meilleur AIC)' if meilleur_aic == recommandation else ' (AIC legerement en faveur de l’autre modele -- a arbitrer avec le clinicien)'}.")

    return {
        "res_poisson": res_poisson, "res_nb": res_nb,
        "dispersion": disp, "tableau_comparaison": tableau,
        "recommandation": recommandation,
    }


def choisir_modele_tap(comparaison: dict) -> str:
    print("\nQuel modele retenez-vous pour valider la distribution du TAP "
          "precoce (Poisson ou Binomiale Negative) ?")
    reco = comparaison["recommandation"]
    print(f"  [1] Poisson")
    print(f"  [2] Binomiale Negative")
    print(f"  (recommandation du script : "
          f"{'Poisson' if reco == 'poisson' else 'Binomiale Negative'})")
    choix = input("Choix : ").strip()
    modele = "poisson" if choix == "1" else "nb" if choix == "2" else reco
    if choix not in ("1", "2"):
        print(f"  Choix non reconnu, recommandation retenue par defaut.")
    print(f"\n-> Modele retenu pour la validation du TAP : "
          f"{'Poisson' if modele == 'poisson' else 'Binomiale Negative'}.")
    print("  Rappel : ce choix documente/valide la distribution des comptes "
          "de poussees dans le registre. Le TAP EMPIRIQUE individuel "
          "(n poussees / exposition) reste la variable utilisee comme "
          "predicteur dans le modele mixte de l'etape 2, conformement a "
          "la formulation du fichier ('TAP (n poussees/an)').")
    return modele


def graphique_comparaison_tap(df_tap: pd.DataFrame, comparaison: dict):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    ax = axes[0]
    max_count = int(df_tap["n_poussees_fenetre"].max())
    bins = np.arange(0, max_count + 2) - 0.5
    ax.hist(df_tap["n_poussees_fenetre"], bins=bins, edgecolor="k",
            alpha=0.6, color="steelblue", label="Observe")
    ax.set_xlabel("Nombre de poussees dans la fenetre precoce")
    ax.set_ylabel("Nombre de patients")
    ax.set_title("Distribution observee du nombre de poussees")
    ax.legend()

    ax = axes[1]
    res_p, res_nb = comparaison["res_poisson"], comparaison["res_nb"]
    ax.scatter(res_p.fittedvalues, df_tap["n_poussees_fenetre"],
               alpha=0.5, label="vs Poisson (ajuste)", color="darkorange")
    lim = max(df_tap["n_poussees_fenetre"].max(), res_p.fittedvalues.max()) + 1
    ax.plot([0, lim], [0, lim], color="grey", linestyle="--")
    ax.set_xlabel("Valeur predite (moyenne du modele)")
    ax.set_ylabel("Nombre de poussees observe")
    ax.set_title("Ajustement observe vs predit (Poisson)")

    plt.tight_layout()
    plt.savefig("/mnt/user-data/outputs/test3_comparaison_poisson_nb.png", dpi=150)
    plt.close()
    print("\nGraphique sauvegarde : test3_comparaison_poisson_nb.png")


def exclure_edss_post_poussee(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                               fenetre_mois: int) -> pd.DataFrame:
    
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
    print(f"  Fenetre post-poussee = {fenetre_mois} mois : {n_exclus} mesures "
          f"EDSS exclues sur {len(df)} (proximite avec une poussee, toutes "
          f"poussees confondues).")
    return df[~a_exclure].copy()


def preparer_dataset_modele_mixte(df_edss: pd.DataFrame, df_poussees: pd.DataFrame,
                                   df_tap: pd.DataFrame,
                                   fenetre_post_poussee_mois: int) -> pd.DataFrame:
    df = df_edss.merge(df_tap[["patient_id", "tap_empirique"]], on="patient_id", how="inner")
    n_sans_tap = df_edss["patient_id"].nunique() - df["patient_id"].nunique()
    if n_sans_tap > 0:
        print(f"  {n_sans_tap} patient(s) sans TAP calculable (exposition "
              f"trop courte) exclu(s) du modele mixte.")

    df["temps_annees"] = (df["date_visite"] - df["date_onset"]).dt.days / 365.25
    n_avant = (df["temps_annees"] < 0).sum()
    if n_avant:
        print(f"[ATTENTION] {n_avant} visites avec date_visite < date_onset "
              f"retirees.")
        df = df[df["temps_annees"] >= 0]
    df["temps_annees_pos"] = df["temps_annees"] + EPSILON_TIME

    print(f"\n--- Exclusion post-poussee (fenetre = {fenetre_post_poussee_mois} mois) ---")
    df = exclure_edss_post_poussee(df, df_poussees, fenetre_post_poussee_mois)

    n_visites = df.groupby("patient_id").size()
    patients_valides = n_visites[n_visites >= 2].index
    n_retires = df["patient_id"].nunique() - len(patients_valides)
    if n_retires:
        print(f"  {n_retires} patient(s) avec <2 mesures EDSS retires "
              f"(pas de trajectoire estimable).")
    df = df[df["patient_id"].isin(patients_valides)].copy()

    n_patients_final = df["patient_id"].nunique()
    n_points_final = len(df)
    duree_suivi_mediane = (
        df.groupby("patient_id")["temps_annees"].max().median()
        if n_patients_final > 0 else np.nan
    )
    print(f"\nDonnees finales : {n_patients_final} patients, {n_points_final} "
          f"points EDSS.")
    if not np.isnan(duree_suivi_mediane):
        print(f"Duree de suivi mediane par patient : {duree_suivi_mediane:.1f} ans.")

    if n_patients_final < MIN_PATIENTS_ALERTE or n_points_final < MIN_POINTS_ALERTE:
        print(f"  [ALERTE EFFECTIF] {n_patients_final} patients / "
              f"{n_points_final} points -- effectif limite pour un modele "
              f"mixte (seuils indicatifs {MIN_PATIENTS_ALERTE}/"
              f"{MIN_POINTS_ALERTE}). A presenter avec cette reserve.")

    print("\n  [RAPPEL LITTERATURE PEDIATRIE -- a citer si l'effet du TAP "
          "n'est pas significatif] La SEP pediatrique presente un DECOUPLAGE "
          "PARTIEL entre frequence des poussees et EDSS : les enfants ont "
          "generalement un TAP plus eleve et plus soutenu que les adultes, "
          "mais recuperent souvent mieux, si bien que l'EDSS reste bas plus "
          "longtemps. Un effet du TAP non significatif ici doit donc etre "
          "interprete comme 'coherent avec ce decouplage pediatrique "
          "documente', pas comme une absence de lien biologique entre "
          "poussees et handicap.")

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
    else:
        raise ValueError("transformation_temps invalide")


def ajuster_modele_mixte(df: pd.DataFrame, transformation_temps: str = "lineaire",
                          reml: bool = True):
    df = df.copy()
    colonnes_temps = obtenir_colonnes_temps(df, transformation_temps)
    termes_interaction = " + ".join(f"tap_empirique * {c}" for c in colonnes_temps)
    formule = f"edss ~ {termes_interaction}"
    re_formula_pente = "~" + "+".join(colonnes_temps)

    visites_par_patient = df.groupby("patient_id").size()
    part_suffisante = (visites_par_patient >= MIN_VISITS_FOR_RANDOM_SLOPE).mean()

    def _fit(re_formula_locale, reml_local):
        modele = smf.mixedlm(formule, data=df, groups=df["patient_id"],
                              re_formula=re_formula_locale)
        try:
            res = modele.fit(reml=reml_local, method="lbfgs")
            if reml_local and not res.converged:
                raise np.linalg.LinAlgError("REML non converge")
            return res, reml_local
        except Exception as e:
            if reml_local:
                print(f"  [REPLI REML->ML] Echec REML ({e}) -- bascule ML.")
                return modele.fit(reml=False, method="lbfgs"), False
            raise

    resultat, type_modele, reml_effectif = None, None, reml
    if part_suffisante >= 0.5:
        try:
            resultat, reml_effectif = _fit(re_formula_pente, reml)
            type_modele = "intercept + pente aleatoires" if resultat.converged else None
            if not resultat.converged:
                resultat = None
        except Exception as e:
            print(f"  [Pente aleatoire] echec : {e}")
            resultat = None

    if resultat is None:
        print("  -> Repli sur INTERCEPT ALEATOIRE SEUL.")
        resultat, reml_effectif = _fit(None, reml)
        type_modele = "intercept aleatoire seul"

    if reml_effectif != reml:
        type_modele += " [REML->ML]"

    return resultat, type_modele, df


def choisir_meilleure_transformation_temps(df: pd.DataFrame) -> pd.DataFrame:
    lignes = []
    for transfo in ["lineaire", "racine", "log", "combinee"]:
        try:
            resultat, type_modele, _ = ajuster_modele_mixte(df, transfo, reml=False)
            lignes.append({
                "transformation": transfo, "type_modele": type_modele,
                "aic": resultat.aic, "log_vraisemblance": resultat.llf,
                "converged": resultat.converged,
            })
        except Exception as e:
            lignes.append({"transformation": transfo, "type_modele": "echec",
                            "aic": np.nan, "log_vraisemblance": np.nan,
                            "converged": False})
            print(f"[ECHEC] transformation={transfo} : {e}")

    tableau = pd.DataFrame(lignes).sort_values("aic")
    print("\n--- Comparaison des transformations du temps (AIC croissant) ---")
    print(tableau.to_string(index=False))
    return tableau


def effet_par_unite_tap(resultat, t: float, transformation_temps: str) -> tuple:
    if transformation_temps == "lineaire":
        t_f_par_terme = {"temps_f": t}
    elif transformation_temps == "racine":
        t_f_par_terme = {"temps_f": np.sqrt(t + EPSILON_TIME)}
    elif transformation_temps == "log":
        t_f_par_terme = {"temps_f": np.log(t + EPSILON_TIME)}
    elif transformation_temps == "combinee":
        t_f_par_terme = {"temps_f_racine": np.sqrt(t + EPSILON_TIME),
                          "temps_f_log": np.log(t + EPSILON_TIME)}
    else:
        raise ValueError("transformation_temps invalide")

    params = resultat.params
    cov = resultat.cov_params()
    noms = list(params.index)
    L = np.zeros(len(noms))
    L[noms.index("tap_empirique")] = 1.0
    for col_temps, val in t_f_par_terme.items():
        nom_int = f"tap_empirique:{col_temps}"
        if nom_int in noms:
            L[noms.index(nom_int)] = val

    effet = float(L @ params.values)
    var = float(L @ cov.values @ L.T)
    se = np.sqrt(max(var, 0))
    ic_inf, ic_sup = effet - 1.96 * se, effet + 1.96 * se
    z = effet / se if se > 0 else np.nan
    p = 2 * (1 - stats.norm.cdf(abs(z))) if not np.isnan(z) else np.nan
    return effet, se, ic_inf, ic_sup, p


def interpreter_effet_clinique(resultat, transformation_temps: str,
                                horizons_annees=(2, 5, 10),
                                suivi_max_observe: float = None) -> pd.DataFrame:
    horizons_extrapoles = []
    if suivi_max_observe is not None:
        horizons_extrapoles = [t for t in horizons_annees if t > suivi_max_observe]
        if horizons_extrapoles:
            print(f"\n  [ATTENTION EXTRAPOLATION] Horizon(s) {horizons_extrapoles} "
                  f"an(s) au-dela du suivi maximal observe "
                  f"({suivi_max_observe:.1f} ans) -- IC95% a interpreter avec "
                  f"une prudence extreme a ces horizons.")

    lignes = []
    for t in (0,) + tuple(horizons_annees):
        effet, se, ic_inf, ic_sup, p = effet_par_unite_tap(resultat, t, transformation_temps)
        lignes.append({
            "horizon_annees": t, "effet_par_poussee_an": round(effet, 3),
            "erreur_standard": round(se, 3), "IC95_inf": round(ic_inf, 3),
            "IC95_sup": round(ic_sup, 3),
            "p_value": round(p, 4) if not np.isnan(p) else np.nan,
            "significatif_5pct": (p < 0.05) if not np.isnan(p) else None,
            "extrapolation_hors_suivi": (t in horizons_extrapoles),
        })

    tableau = pd.DataFrame(lignes)
    print("\n--- Effet clinique du TAP precoce sur l'EDSS (par poussee/an "
          "supplementaire, IC95%) ---")
    print(tableau.to_string(index=False))

    derniere = tableau.iloc[-1]
    sig_txt = ("statistiquement significatif" if derniere["significatif_5pct"]
               else "non significatif avec cet effectif -- cf. rappel sur le "
                    "decouplage TAP/EDSS pediatrique")
    print(f"\n  -> Phrase pour l'encadrante : \"A {int(derniere['horizon_annees'])} "
          f"ans de suivi, chaque poussee/an supplementaire durant la fenetre "
          f"precoce est associee a une variation moyenne de "
          f"{derniere['effet_par_poussee_an']:.2f} point(s) d'EDSS "
          f"[IC95% {derniere['IC95_inf']:.2f} ; {derniere['IC95_sup']:.2f}] "
          f"(p={derniere['p_value']:.3f}, {sig_txt}).\"")
    return tableau


def tracer_trajectoires_par_tap(df: pd.DataFrame, resultat, transformation_temps: str):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    tertiles = df.drop_duplicates("patient_id")["tap_empirique"].quantile([1/3, 2/3]).values
    def groupe_tap(v):
        if v <= tertiles[0]:
            return "TAP bas"
        elif v <= tertiles[1]:
            return "TAP moyen"
        return "TAP eleve"

    couleurs = {"TAP bas": "#2166ac", "TAP moyen": "#8c8c8c", "TAP eleve": "#b2182b"}

    ax = axes[0]
    for pid, groupe in df.groupby("patient_id"):
        groupe = groupe.sort_values("temps_annees")
        cat = groupe_tap(groupe["tap_empirique"].iloc[0])
        ax.plot(groupe["temps_annees"], groupe["edss"], color=couleurs[cat],
                alpha=0.25, linewidth=0.8)
    for cat, coul in couleurs.items():
        ax.plot([], [], color=coul, label=cat)
    ax.set_xlabel("Temps depuis l'onset (annees)")
    ax.set_ylabel("EDSS")
    ax.set_title("Trajectoires individuelles par tertile de TAP precoce")
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
                      "TAP eleve": tertiles[1] * 1.5}
    for cat, tap_val in tap_reference.items():
        edss_pred = params.get("Intercept", 0) + params.get("tap_empirique", 0) * tap_val
        for col_temps, t_f in termes_temps.items():
            edss_pred = (edss_pred + params.get(col_temps, 0) * t_f
                         + params.get(f"tap_empirique:{col_temps}", 0) * tap_val * t_f)
        ax.plot(t_range, edss_pred, color=couleurs[cat], linewidth=2.5, label=cat)
    ax.set_xlabel("Temps depuis l'onset (annees)")
    ax.set_ylabel("EDSS predit")
    ax.set_title("Trajectoire moyenne predite selon le TAP precoce")
    ax.legend()

    plt.tight_layout()
    plt.savefig("/mnt/user-data/outputs/test3_trajectoires_tap.png", dpi=150)
    plt.close()
    print("\nGraphique sauvegarde : test3_trajectoires_tap.png")


def calculer_diagnostics(resultat, df: pd.DataFrame) -> dict:
    predictions = resultat.fittedvalues
    residus = df["edss"].values - predictions.values
    rmse = np.sqrt(np.mean(residus ** 2))
    pwpe = np.mean(np.abs(residus) <= 0.5) * 100
    pope = np.mean(np.abs(residus) > 2.0) * 100
    print("\n--- Diagnostics du modele mixte ---")
    print(f"  RMSE : {rmse:.3f} points EDSS")
    print(f"  PWPE : {pwpe:.1f}% des predictions a +/-0.5 point")
    print(f"  POPE : {pope:.1f}% des predictions a plus de +/-2 points")
    return {"RMSE": rmse, "PWPE_pct": pwpe, "POPE_pct": pope}


def analyse_complete(engine, horizons_annees=(2, 5, 10)):
    print("=" * 80)
    print("TAP precoce et evolution du handicap - Registre SEP pediatrique")
    print("(Poisson + modele mixte)")
    print("=" * 80)

    df_edss = charger_edss(engine)
    df_poussees = charger_poussees(engine)

    print("\n" + "=" * 80)
    print("ETAPE 1a : Calcul du TAP precoce par patient")
    print("=" * 80)
    fenetre_tap = choisir_fenetre_tap()
    df_tap = calculer_tap_par_patient(df_edss, df_poussees, fenetre_tap)

    covariables_patients = charger_covariables_patients(engine)
    df_tap = df_tap.merge(
        covariables_patients[["patient_id", "age_onset_annees", "sexe", "edss_inclusion"]],
        on="patient_id", how="left",
    )

    print("\n" + "=" * 80)
    print("ETAPE 1b : Poisson vs Binomiale Negative")
    print("=" * 80)
    covariables_tap = choisir_covariables_tap(df_tap)
    comparaison = comparer_poisson_nb(df_tap, covariables_tap)
    graphique_comparaison_tap(df_tap, comparaison)
    modele_tap_choisi = choisir_modele_tap(comparaison)

    print("\n" + "=" * 80)
    print("ETAPE 2 : Preparation des donnees pour le modele mixte EDSS(t)")
    print("=" * 80)
    fenetre_post_poussee = FENETRE_POST_POUSSEE_DEFAUT_MOIS
    df_modele = preparer_dataset_modele_mixte(
        df_edss, df_poussees, df_tap, fenetre_post_poussee,
    )

    print("\n" + "=" * 80)
    print("ETAPE 3 : Choix de la transformation du temps")
    print("=" * 80)
    tableau_transfos = choisir_meilleure_transformation_temps(df_modele)
    meilleure_transfo = tableau_transfos.iloc[0]["transformation"]
    print(f"\n  -> Transformation retenue (AIC minimal) : {meilleure_transfo}")

    print("\n" + "=" * 80)
    print("ETAPE 4 : Ajustement du modele mixte final (REML)")
    print("=" * 80)
    resultat, type_modele, df_final = ajuster_modele_mixte(df_modele, meilleure_transfo, reml=True)
    print(f"\n  Type de modele retenu : {type_modele}")
    print(f"  Convergence : {resultat.converged}")
    print("\n" + resultat.summary().as_text())

    print("\n" + "=" * 80)
    print("ETAPE 5 : Diagnostics")
    print("=" * 80)
    calculer_diagnostics(resultat, df_final)

    print("\n" + "=" * 80)
    print("ETAPE 6 : Interpretation clinique")
    print("=" * 80)
    suivi_max = df_final["temps_annees"].max()
    tableau_effets = interpreter_effet_clinique(
        resultat, meilleure_transfo, horizons_annees=horizons_annees,
        suivi_max_observe=suivi_max,
    )

    print("\n" + "=" * 80)
    print("ETAPE 7 : Visualisation")
    print("=" * 80)
    tracer_trajectoires_par_tap(df_final, resultat, meilleure_transfo)

    return {
        "comparaison_tap": comparaison,
        "modele_tap_choisi": modele_tap_choisi,
        "df_tap": df_tap,
        "resultat_mixte": resultat,
        "type_modele_mixte": type_modele,
        "df_final": df_final,
        "tableau_effets": tableau_effets,
    }


if __name__ == "__main__":
    HORIZONS_CLINIQUES = (2, 5, 10)

    moteur = obtenir_moteur_postgres()
    resultats = analyse_complete(moteur, horizons_annees=HORIZONS_CLINIQUES)
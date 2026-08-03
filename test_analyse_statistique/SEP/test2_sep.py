

import warnings
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
import statsmodels.api as sm
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore", category=UserWarning)

RELAPSE_WINDOWS_MONTHS = [1, 3, 6]     
                                        
FENETRE_POST_POUSSEE_DEFAUT_MOIS = 3   
MIN_POINTS_ALERTE = 30                 
MIN_PATIENTS_ALERTE = 15
QUARTER_AGGREGATION = True             
TIME_TRUNCATION_YEARS = None          
MIN_VISITS_FOR_RANDOM_SLOPE = 3       
EPSILON_TIME = 1e-3                    

def charger_donnees(chemin_csv: str) -> pd.DataFrame:
    df = pd.read_csv(
        chemin_csv,
        parse_dates=["date_premier_symptome", "date_visite", "date_derniere_poussee"],
    )

    colonnes_requises = {
        "patient_id", "date_premier_symptome", "date_visite", "score_edss",
        "recuperation_1er_episode",
    }
    manquantes = colonnes_requises - set(df.columns)
    if manquantes:
        raise ValueError(f"Colonnes manquantes dans le CSV : {manquantes}")

   
    if pd.api.types.is_numeric_dtype(df["recuperation_1er_episode"]):
        df["recuperation_incomplete"] = (
            df["recuperation_1er_episode"].astype(int)
        )
    else:
        df["recuperation_incomplete"] = (
            df["recuperation_1er_episode"].astype(str).str.lower().str.strip()
            == "incomplete"
        ).astype(int)

    return df


def calculer_temps_depuis_onset(df: pd.DataFrame) -> pd.DataFrame:
    
    df = df.copy()
    df["temps_annees"] = (
        (df["date_visite"] - df["date_premier_symptome"]).dt.days / 365.25
    )
    n_avant = (df["temps_annees"] < 0).sum()
    if n_avant:
        print(f"[ATTENTION] {n_avant} visites avec date_visite < date_premier_symptome "
              f"retirees (verifier la saisie).")
        df = df[df["temps_annees"] >= 0]
    
    df["temps_annees_pos"] = df["temps_annees"] + EPSILON_TIME
    return df


def exclure_edss_post_poussee(df: pd.DataFrame, fenetre_mois: int) -> pd.DataFrame:
    
    df = df.copy()
    if "date_derniere_poussee" not in df.columns:
        print("[INFO] Pas de colonne date_derniere_poussee : aucune "
              "exclusion post-poussee appliquee (a corriger si possible).")
        return df

    delai_jours = (df["date_visite"] - df["date_derniere_poussee"]).dt.days
    a_exclure = (delai_jours >= 0) & (delai_jours < fenetre_mois * 30.44)
    n_exclus = a_exclure.sum()
    print(f"  Fenetre {fenetre_mois} mois post-poussee : "
          f"{n_exclus} EDSS exclus sur {len(df)}.")
    return df[~a_exclure].copy()


def agreger_par_trimestre(df: pd.DataFrame, colonnes_supp=None) -> pd.DataFrame:
    
    if not QUARTER_AGGREGATION:
        return df

    df = df.copy()
    df["trimestre"] = (df["temps_annees"] * 4).round().astype(int)

    agg_dict = {
        "score_edss": ("score_edss", "median"),
        "temps_annees": ("temps_annees", "median"),
        "temps_annees_pos": ("temps_annees_pos", "median"),
        "recuperation_incomplete": ("recuperation_incomplete", "first"),
    }
    for col in (colonnes_supp or []):
        agg_dict[col] = (col, "first")

    agg = (
        df.groupby(["patient_id", "trimestre"], as_index=False)
        .agg(**agg_dict)
    )
    print(f"  Agregation trimestrielle : {len(df)} visites -> {len(agg)} "
          f"points EDSS (mediane par trimestre/patient).")
    return agg


def preparer_donnees(chemin_csv: str, fenetre_mois: int = 3,
                      variables_supplementaires=None) -> pd.DataFrame:
    df = charger_donnees(chemin_csv)
    df = calculer_temps_depuis_onset(df)

    print("\n  [A CONFIRMER AVEC L'ENCADRANTE] La colonne "
          "'recuperation_1er_episode' est utilisee telle quelle. Sotiropoulos "
          "et al. definissent precisement la recuperation incomplete comme "
          "un retour incomplet de l'EDSS ET du score fonctionnel (FSS) a la "
          "baseline PRE-poussee, evalue a 6 mois post-poussee. Ce script ne "
          "peut PAS verifier automatiquement que votre codage suit cette "
          "definition (les FSS ne font pas partie du format de donnees "
          "attendu). Si le codage de l'encadrante differe (delai different, "
          "evaluation subjective sans FSS, etc.), le signaler explicitement "
          "dans le rapport -- vos resultats ne seront alors pas strictement "
          "comparables aux references citees.")

    colonnes_supp = valider_variables_supplementaires(variables_supplementaires, df)

    print(f"\n--- Exclusion post-poussee (fenetre = {fenetre_mois} mois) ---")
    df = exclure_edss_post_poussee(df, fenetre_mois)

    if TIME_TRUNCATION_YEARS is not None:
        n_avant = len(df)
        df = df[df["temps_annees"] <= TIME_TRUNCATION_YEARS]
        print(f"  Troncature a {TIME_TRUNCATION_YEARS} ans : "
              f"{n_avant - len(df)} points retires.")

    print("\n--- Agregation trimestrielle (reduction autocorrelation) ---")
    df = agreger_par_trimestre(df, colonnes_supp=colonnes_supp)

  
    n_visites = df.groupby("patient_id").size()
    patients_valides = n_visites[n_visites >= 2].index
    n_retires = df["patient_id"].nunique() - len(patients_valides)
    if n_retires:
        print(f"  {n_retires} patients avec <2 mesures EDSS retires "
              f"(pas de trajectoire estimable).")
    df = df[df["patient_id"].isin(patients_valides)].copy()

    n_patients_final = df['patient_id'].nunique()
    n_points_final = len(df)
    duree_suivi_mediane = (
        df.groupby("patient_id")["temps_annees"].max().median()
        if n_patients_final > 0 else np.nan
    )
    print(f"\nDonnees finales : {n_patients_final} patients, "
          f"{n_points_final} points EDSS.")
    print(f"Duree de suivi mediane par patient : "
          f"{duree_suivi_mediane:.1f} ans." if not np.isnan(duree_suivi_mediane)
          else "Duree de suivi : non calculable.")

    if n_patients_final < MIN_PATIENTS_ALERTE or n_points_final < MIN_POINTS_ALERTE:
        print(f"  [ALERTE EFFECTIF] {n_patients_final} patients / "
              f"{n_points_final} points restants apres exclusions -- "
              f"effectif limite pour un modele mixte (a comparer aux "
              f"seuils indicatifs de {MIN_PATIENTS_ALERTE} patients / "
              f"{MIN_POINTS_ALERTE} points). Les estimations (effet, "
              f"IC95%, p-value) qui suivront doivent etre presentees a "
              f"l'encadrante avec cette reserve explicite -- ce n'est pas "
              f"une raison de ne pas analyser, mais l'interpretation doit "
              f"rester prudente.")

    if not np.isnan(duree_suivi_mediane) and duree_suivi_mediane < 5:
        print(f"\n  [ALERTE SPECIFIQUE PEDIATRIE] Suivi median de "
              f"{duree_suivi_mediane:.1f} ans, inferieur aux ~8,5 ans de "
              f"suivi utilises par Sotiropoulos et al. pour estimer un "
              f"effet a 10 ans. La litterature pediatrique montre une "
              f"progression de l'EDSS nettement plus lente et plus tardive "
              f"que chez l'adulte (cohorte Ped-MSSS, n=873 : seulement "
              f"52%/19,4%/1,5% des patients atteignent un EDSS de "
              f"2/3/6 a un moment quelconque du suivi). Avec un suivi "
              f"court, le modele risque de manquer de puissance pour "
              f"detecter une interaction temps x recuperation, MEME SI "
              f"l'effet existe reellement (il se manifeste parfois sur "
              f"15-20 ans en pediatrie). Un resultat non significatif ici "
              f"doit donc etre interprete comme 'non conclusif avec ce "
              f"suivi', pas comme 'absence d'effet' -- a expliciter "
              f"clairement aupres de l'encadrante.")
    return df




def comparer_fenetres_post_poussee(chemin_csv: str) -> pd.DataFrame:
    
    resultats = []
    for fenetre in RELAPSE_WINDOWS_MONTHS:
        print(f"\n=== Fenetre post-poussee = {fenetre} mois (indicatif) ===")
        df = preparer_donnees(chemin_csv, fenetre_mois=fenetre)
        try:
            modele = smf.mixedlm(
                "score_edss ~ recuperation_incomplete * temps_annees",
                data=df,
                groups=df["patient_id"],
            )
            resultat = modele.fit(reml=False, method="lbfgs")
            var_intercept = resultat.cov_re.iloc[0, 0]
            resultats.append({
                "fenetre_mois": fenetre,
                "n_points": len(df),
                "n_patients": df["patient_id"].nunique(),
                "variance_intercept_indicative": var_intercept,
                "aic_non_comparable_entre_lignes": resultat.aic,
            })
        except Exception as e:
            print(f"  [ECHEC convergence] {e}")
            resultats.append({
                "fenetre_mois": fenetre, "n_points": len(df),
                "n_patients": df["patient_id"].nunique(),
                "variance_intercept_indicative": np.nan,
                "aic_non_comparable_entre_lignes": np.nan,
            })

    tableau = pd.DataFrame(resultats)
    print("\n--- Effet de la fenetre post-poussee sur l'effectif disponible "
          "(tableau DESCRIPTIF, pas un critere de decision) ---")
    print(tableau.to_string(index=False))
    print(f"\n-> Ce tableau n'est pas utilise pour choisir automatiquement "
          f"une fenetre (l'AIC n'y est pas comparable d'une ligne a "
          f"l'autre). La fenetre par defaut du pipeline est "
          f"{FENETRE_POST_POUSSEE_DEFAUT_MOIS} mois (cf. reference). "
          f"A valider ou modifier avec l'encadrante selon la plausibilite "
          f"clinique du delai de stabilisation post-poussee en "
          f"pediatrie, et selon l'effectif restant dans chaque colonne "
          f"ci-dessus.")
    return tableau




VARIABLES_SUPPLEMENTAIRES_AUTORISEES = {
    "severite_poussee": {
        "colonne_attendue": "severite_poussee",
        "source": "Meta-analyse sur la recuperation incomplete (ScienceDirect, "
                   "2025) : facteur le plus constant de la recuperation "
                   "incomplete (OR 2.38-17.2).",
    },
    "age_diagnostic": {
        "colonne_attendue": "age_diagnostic_annees",
        "source": "Sotiropoulos et al. 2021 ; modele multilevel Uzochukwu et al. "
                   "2023/2024 : covariable de base ajustee.",
    },
    "sexe": {
        "colonne_attendue": "sexe",
        "source": "Sotiropoulos et al. 2021 ; Uzochukwu et al. 2023/2024 : "
                   "covariable de base ajustee.",
    },
    "traitement_dmt": {
        "colonne_attendue": "proportion_suivi_dmt",
        "source": "Uzochukwu et al. 2023/2024 ; etude LMMRM trajectoires SEP "
                   "pediatrique/adulte/tardive (2024) : proportion du suivi "
                   "sous DMT actif, covariable ajustee.",
    },
}


def valider_variables_supplementaires(variables_supplementaires, df):
    
    if not variables_supplementaires:
        return []
    noms_colonnes = []
    for v in variables_supplementaires:
        if v not in VARIABLES_SUPPLEMENTAIRES_AUTORISEES:
            raise ValueError(
                f"Variable '{v}' non autorisee : aucune reference "
                f"bibliographique associee dans ce script. Variables "
                f"disponibles : {list(VARIABLES_SUPPLEMENTAIRES_AUTORISEES)}. "
                f"Si cette variable est pertinente, trouver d'abord une "
                f"reference qui la justifie et l'ajouter consciemment a "
                f"VARIABLES_SUPPLEMENTAIRES_AUTORISEES."
            )
        col = VARIABLES_SUPPLEMENTAIRES_AUTORISEES[v]["colonne_attendue"]
        if col not in df.columns:
            raise ValueError(
                f"Variable '{v}' demandee mais colonne '{col}' absente du "
                f"CSV. Colonnes disponibles : {list(df.columns)}."
            )
        noms_colonnes.append(col)
    return noms_colonnes


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
        raise ValueError("transformation_temps doit etre 'lineaire', "
                          "'racine', 'log' ou 'combinee'")


def ajuster_modele_mixte(df: pd.DataFrame, transformation_temps: str = "lineaire",
                          reml: bool = True, variables_supplementaires=None):
    

    df = df.copy()
    colonnes_temps = obtenir_colonnes_temps(df, transformation_temps)
    colonnes_supp = valider_variables_supplementaires(variables_supplementaires, df)
    termes_interaction = " + ".join(
        f"recuperation_incomplete * {c}" for c in colonnes_temps
    )
    formule = f"score_edss ~ {termes_interaction}"
    for col in colonnes_supp:
        formule += f" + {col}"
    re_formula_pente = "~" + "+".join(colonnes_temps)

    visites_par_patient = df.groupby("patient_id").size()
    part_suffisante = (visites_par_patient >= MIN_VISITS_FOR_RANDOM_SLOPE).mean()

    def _fit(re_formula_locale, reml_local):
       
        modele = smf.mixedlm(
            formule, data=df, groups=df["patient_id"],
            re_formula=re_formula_locale,
        )
        try:
            res = modele.fit(reml=reml_local, method="lbfgs")
            if reml_local and not res.converged:
                raise np.linalg.LinAlgError("REML non converge (lbfgs)")
            return res, reml_local
        except (np.linalg.LinAlgError, Exception) as e:
            if reml_local:
                print(f"  [REPLI REML->ML] L'ajustement REML a echoue "
                      f"({e}). Bascule sur ML -- PRECAUTION D'INGENIERIE, "
                      f"absente de la reference Uzochukwu et al. Les "
                      f"estimations de variance seront legerement biaisees "
                      f"(a signaler explicitement dans le SAP).")
                res = modele.fit(reml=False, method="lbfgs")
                return res, False
            raise

    resultat, type_modele, reml_effectif = None, None, reml

    if part_suffisante >= 0.5:
        try:
            resultat, reml_effectif = _fit(re_formula_pente, reml)
            if resultat.converged:
                type_modele = "intercept + pente aleatoires"
            else:
                resultat = None
        except Exception as e:
            print(f"  [Pente aleatoire] echec : {e}")
            resultat = None

    if resultat is None:
        print("  -> Repli sur INTERCEPT ALEATOIRE SEUL "
              "(effectif insuffisant pour pente aleatoire fiable).")
        resultat, reml_effectif = _fit(None, reml)
        type_modele = "intercept aleatoire seul"

    if reml_effectif != reml:
        type_modele += " [REML->ML, echec convergence REML]"

    return resultat, type_modele, df


def choisir_meilleure_transformation_temps(df: pd.DataFrame,
                                            variables_supplementaires=None) -> pd.DataFrame:
    
    lignes = []
    for transfo in ["lineaire", "racine", "log", "combinee"]:
        try:
            
            resultat, type_modele, _ = ajuster_modele_mixte(
                df, transfo, reml=False,
                variables_supplementaires=variables_supplementaires,
            )
            lignes.append({
                "transformation": transfo,
                "type_modele": type_modele,
                "aic": resultat.aic,
                "log_vraisemblance": resultat.llf,
                "converged": resultat.converged,
            })
        except Exception as e:
            lignes.append({
                "transformation": transfo, "type_modele": "echec",
                "aic": np.nan, "log_vraisemblance": np.nan,
                "converged": False,
            })
            print(f"[ECHEC] transformation={transfo} : {e}")

    tableau = pd.DataFrame(lignes).sort_values("aic")
    print("\n--- Comparaison des transformations du temps (AIC croissant) ---")
    print(tableau.to_string(index=False))
    return tableau


def calculer_diagnostics(resultat, df: pd.DataFrame) -> dict:
    
    predictions = resultat.fittedvalues
    residus = df["score_edss"].values - predictions.values
    rmse = np.sqrt(np.mean(residus ** 2))
    pwpe = np.mean(np.abs(residus) <= 0.5) * 100
    pope = np.mean(np.abs(residus) > 2.0) * 100

    diag = {"RMSE": rmse, "PWPE_pct": pwpe, "POPE_pct": pope}
    print("\n--- Diagnostics du modele ---")
    print(f"  RMSE : {rmse:.3f} points EDSS")
    print(f"  PWPE : {pwpe:.1f}% des predictions a +/-0.5 point de l'EDSS observe")
    print(f"  POPE : {pope:.1f}% des predictions a plus de +/-2 points de l'EDSS observe")
    return diag


def verifier_heteroscedasticite(resultat, df: pd.DataFrame):
    
    residus = df["score_edss"].values - resultat.fittedvalues.values

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))

    ax = axes[0]
    ax.scatter(df["score_edss"], residus, alpha=0.4, s=15)
    ax.axhline(0, color="black", linewidth=0.8)
    ax.set_xlabel("EDSS observe")
    ax.set_ylabel("Residu (observe - predit)")
    ax.set_title("Variance residuelle vs EDSS\n(effet d'echelle, PAS le CLOV)")

    ax = axes[1]
    ax.scatter(df["temps_annees"], residus, alpha=0.4, s=15, color="darkorange")
    ax.axhline(0, color="black", linewidth=0.8)
    ax.set_xlabel("Temps depuis l'onset (annees)")
    ax.set_ylabel("Residu (observe - predit)")
    ax.set_title("Variance residuelle vs TEMPS\n(= CLOV de la reference Uzochukwu et al.)")

    plt.tight_layout()
    plt.savefig("/mnt/user-data/outputs/diagnostic_heteroscedasticite.png", dpi=150)
    plt.close()
    print("  Graphiques de verification d'heteroscedasticite sauvegardes : "
          "diagnostic_heteroscedasticite.png")
    print("  Panneau de DROITE = le CLOV tel que defini par la reference. "
          "Si un entonnoir apparait (variance croissante avec le temps de "
          "suivi), le modele actuel sous-estime l'incertitude aux longs "
          "horizons -> envisager R/MLwiN pour reproduire le CLOV exact, "
          "ou a minima le signaler comme limite dans le SAP.")



def effet_a_horizon(resultat, t: float, transformation_temps: str,
                     nom_var_interaction: str = "recuperation_incomplete:temps_f",
                     nom_var_recup: str = "recuperation_incomplete") -> tuple:
    

    if transformation_temps == "lineaire":
        t_f_par_terme = {"temps_f": t}
    elif transformation_temps == "racine":
        t_f_par_terme = {"temps_f": np.sqrt(t + EPSILON_TIME)}
    elif transformation_temps == "log":
        t_f_par_terme = {"temps_f": np.log(t + EPSILON_TIME)}
    elif transformation_temps == "combinee":
        t_f_par_terme = {
            "temps_f_racine": np.sqrt(t + EPSILON_TIME),
            "temps_f_log": np.log(t + EPSILON_TIME),
        }
    else:
        raise ValueError("transformation_temps invalide")

    params = resultat.params
    cov = resultat.cov_params()
    noms_params = list(params.index)
    L = np.zeros(len(noms_params))
    L[noms_params.index("recuperation_incomplete")] = 1.0
    for col_temps, valeur_t_f in t_f_par_terme.items():
        nom_interaction = f"recuperation_incomplete:{col_temps}"
        if nom_interaction in noms_params:
            L[noms_params.index(nom_interaction)] = valeur_t_f

    effet = float(L @ params.values)
    variance_effet = float(L @ cov.values @ L.T)
    se_effet = np.sqrt(max(variance_effet, 0))

    ic_inf = effet - 1.96 * se_effet
    ic_sup = effet + 1.96 * se_effet
    from scipy import stats
    z = effet / se_effet if se_effet > 0 else np.nan
    p_value = 2 * (1 - stats.norm.cdf(abs(z))) if not np.isnan(z) else np.nan

    return effet, se_effet, ic_inf, ic_sup, p_value


def interpreter_effet_clinique(resultat, transformation_temps: str,
                                horizons_annees=(2, 5, 10),
                                suivi_max_observe: float = None) -> pd.DataFrame:
    

    horizons_extrapoles = []
    if suivi_max_observe is not None:
        horizons_extrapoles = [t for t in horizons_annees if t > suivi_max_observe]
        if horizons_extrapoles:
            print(f"\n  [ATTENTION EXTRAPOLATION] Horizon(s) "
                  f"{horizons_extrapoles} an(s) demande(s) au-dela du suivi "
                  f"maximal observe ({suivi_max_observe:.1f} ans). Le modele "
                  f"projette une droite/courbe hors de la plage de donnees "
                  f"observees -- les IC95% a ces horizons seront tres larges "
                  f"et ne doivent PAS etre presentes comme une estimation "
                  f"fiable. A signaler explicitement si retenu dans le SAP, "
                  f"ou a retirer de horizons_annees si le suivi est trop "
                  f"court pour le justifier.")

    lignes = []
    for t in (0,) + tuple(horizons_annees):
        effet, se, ic_inf, ic_sup, p = effet_a_horizon(
            resultat, t, transformation_temps
        )
        lignes.append({
            "horizon_annees": t,
            "effet_edss": round(effet, 3),
            "erreur_standard": round(se, 3),
            "IC95_inf": round(ic_inf, 3),
            "IC95_sup": round(ic_sup, 3),
            "p_value": round(p, 4) if not np.isnan(p) else np.nan,
            "significatif_5pct": (p < 0.05) if not np.isnan(p) else None,
            "extrapolation_hors_suivi": (t in horizons_extrapoles),
        })

    tableau = pd.DataFrame(lignes)
    print("\n--- Effet clinique de la recuperation incomplete sur l'EDSS "
          "(avec IC95%) ---")
    print(tableau.to_string(index=False))

    derniere = tableau.iloc[-1]
    sig_txt = ("statistiquement significatif" if derniere["significatif_5pct"]
                else "non significatif avec cet effectif -- a interpreter "
                     "avec prudence")
    extrapol_txt = (" [EXTRAPOLATION au-dela du suivi observe -- a ne pas "
                     "presenter comme fiable]" if derniere["extrapolation_hors_suivi"]
                     else "")
    print(f"\n  -> Phrase pour l'encadrante : \"A {int(derniere['horizon_annees'])} ans "
          f"de suivi, un enfant avec recuperation incomplete au 1er episode a "
          f"un EDSS superieur en moyenne de {derniere['effet_edss']:.2f} point(s) "
          f"[IC95% {derniere['IC95_inf']:.2f} ; {derniere['IC95_sup']:.2f}] "
          f"par rapport a un enfant avec recuperation complete "
          f"(p={derniere['p_value']:.3f}, {sig_txt}).\"{extrapol_txt}")
    print("\n  [PRECISION METHODOLOGIQUE -- a ne pas omettre dans le SAP] "
          "Cet effet est une difference de trajectoire ISSUE D'UN MODELE "
          "MIXTE LONGITUDINAL (toutes les visites disponibles, effets "
          "aleatoires par patient), evaluee a un horizon donne. Ce n'est "
          "PAS directement le meme type de quantite que le +0,6 point a "
          "10 ans rapporte par Sotiropoulos et al. 2021, qui provient "
          "d'une regression simple sur un score de handicap a 10 ans "
          "(design different : snapshot vs trajectoire complete). Les "
          "deux resultats vont dans le meme sens et sont d'ordre de "
          "grandeur comparable, mais ne doivent pas etre presentes comme "
          "une reproduction numerique de la reference.")

    return tableau

def tracer_trajectoires(df: pd.DataFrame, resultat, transformation_temps: str):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))

    couleurs = {0: "#2166ac", 1: "#b2182b"}
    labels = {0: "Recuperation complete", 1: "Recuperation incomplete"}

    ax = axes[0]
    for pid, groupe in df.groupby("patient_id"):
        groupe = groupe.sort_values("temps_annees")
        recup = groupe["recuperation_incomplete"].iloc[0]
        ax.plot(groupe["temps_annees"], groupe["score_edss"],
                color=couleurs[recup], alpha=0.25, linewidth=0.8)
    for recup, label in labels.items():
        ax.plot([], [], color=couleurs[recup], label=label)
    ax.set_xlabel("Temps depuis l'onset (annees)")
    ax.set_ylabel("EDSS")
    ax.set_title("Trajectoires individuelles")
    ax.legend()

    ax = axes[1]
    t_range = np.linspace(0, df["temps_annees"].max(), 100)
    if transformation_temps == "lineaire":
        termes_temps = {"temps_f": t_range}
    elif transformation_temps == "racine":
        termes_temps = {"temps_f": np.sqrt(t_range + EPSILON_TIME)}
    elif transformation_temps == "log":
        termes_temps = {"temps_f": np.log(t_range + EPSILON_TIME)}
    elif transformation_temps == "combinee":
        termes_temps = {
            "temps_f_racine": np.sqrt(t_range + EPSILON_TIME),
            "temps_f_log": np.log(t_range + EPSILON_TIME),
        }
    else:
        raise ValueError("transformation_temps invalide")

    params = resultat.params
    for recup, label in labels.items():
        edss_pred = (
            params.get("Intercept", 0)
            + params.get("recuperation_incomplete", 0) * recup
        )
        for col_temps, t_f in termes_temps.items():
            edss_pred = (
                edss_pred
                + params.get(col_temps, 0) * t_f
                + params.get(f"recuperation_incomplete:{col_temps}", 0) * recup * t_f
            )
        ax.plot(t_range, edss_pred, color=couleurs[recup], linewidth=2.5,
                 label=label)
    ax.set_xlabel("Temps depuis l'onset (annees)")
    ax.set_ylabel("EDSS predit")
    ax.set_title("Trajectoire moyenne predite par le modele")
    ax.legend()

    plt.tight_layout()
    chemin = "/mnt/user-data/outputs/trajectoires_edss_recuperation.png"
    plt.savefig(chemin, dpi=150)
    plt.close()
    print(f"\n  Graphique sauvegarde : {chemin}")


def analyse_sensibilite_ordinale(df: pd.DataFrame) -> dict:

    try:
        from statsmodels.miscmodels.ordinal_model import OrderedModel
    except ImportError:
        print("  [INDISPONIBLE] statsmodels.miscmodels.ordinal_model "
              "necessite statsmodels >= 0.12. Analyse de sensibilite "
              "ordinale non executee.")
        return {}

    df_ord = df.copy()
    df_ord["edss_cat"] = pd.Categorical(df_ord["score_edss"], ordered=True)

    print("\n  [LIMITE] Ce modele ordinal traite chaque observation comme "
          "independante -- il ignore que plusieurs mesures EDSS "
          "proviennent du meme enfant. Resultat a interpreter comme un "
          "controle de coherence de DIRECTION uniquement, pas comme une "
          "estimation d'effet fiable.")

    modele = OrderedModel(
        df_ord["edss_cat"],
        df_ord[["recuperation_incomplete", "temps_annees"]],
        distr="logit",
    )
    resultat = modele.fit(method="bfgs", disp=False)

    coef_recup = resultat.params.get("recuperation_incomplete", np.nan)
    p_recup = resultat.pvalues.get("recuperation_incomplete", np.nan)

    print(f"\n  Modele ordinal naif -- effet 'recuperation_incomplete' : "
          f"coef={coef_recup:.3f} (odds ratio={np.exp(coef_recup):.2f}), "
          f"p={p_recup:.4f}")
    print(f"  Coherence de direction avec le modele mixte lineaire : "
          f"{'OUI' if coef_recup > 0 else 'NON -- A INVESTIGUER'} "
          f"(un coefficient positif = risque accru de score EDSS plus "
          f"eleve chez les enfants avec recuperation incomplete, "
          f"coherent avec l'hypothese de l'encadrante).")

    return {"coef_recup_ordinal": coef_recup, "p_value_ordinal": p_recup}

def analyse_complete(chemin_csv: str, fenetre_post_poussee_mois=None,
                      afficher_comparaison_fenetres=True,
                      variables_supplementaires=None,
                      horizons_annees=(2, 5, 10)):
    

    print("=" * 80)
    print("ETAPE 1 : Fenetre d'exclusion post-poussee")
    print("=" * 80)
    if afficher_comparaison_fenetres:
        comparer_fenetres_post_poussee(chemin_csv) 
    if fenetre_post_poussee_mois is None:
        fenetre_post_poussee_mois = FENETRE_POST_POUSSEE_DEFAUT_MOIS
        print(f"\n  -> Fenetre retenue (valeur par defaut, cf. reference) : "
              f"{fenetre_post_poussee_mois} mois. A confirmer avec "
              f"l'encadrante -- ce choix n'est plus derive de l'AIC.")
    else:
        print(f"\n  -> Fenetre imposee par l'encadrante : "
              f"{fenetre_post_poussee_mois} mois.")

    print("\n" + "=" * 80)
    print(f"ETAPE 2 : Preparation des donnees (fenetre retenue = "
          f"{fenetre_post_poussee_mois} mois)")
    print("=" * 80)
    df = preparer_donnees(chemin_csv, fenetre_mois=fenetre_post_poussee_mois,
                           variables_supplementaires=variables_supplementaires)

    if variables_supplementaires:
        noms = ", ".join(variables_supplementaires)
        sources = "; ".join(
            f"{v}: {VARIABLES_SUPPLEMENTAIRES_AUTORISEES[v]['source']}"
            for v in variables_supplementaires
        )
        print(f"\n  Modele AJUSTE demande sur : {noms}")
        print(f"  Sources bibliographiques : {sources}")
    else:
        print("\n  Modele UNIVARIE (recuperation seule), tel que demande "
              "au depart (Tableau 2, ligne 2).")

    print("\n" + "=" * 80)
    print("ETAPE 3 : Choix de la transformation du temps")
    print("=" * 80)
    tableau_transfos = choisir_meilleure_transformation_temps(
        df, variables_supplementaires=variables_supplementaires
    )
    meilleure_transfo = tableau_transfos.iloc[0]["transformation"]
    print(f"\n  -> Transformation retenue (AIC minimal, comparaison valide "
          f"ici -- meme echantillon pour les 4 transformations) : "
          f"{meilleure_transfo}")

    print("\n" + "=" * 80)
    print("ETAPE 4 : Ajustement du modele final (REML, pour rapport clinique)")
    print("=" * 80)
    resultat, type_modele, df_modele = ajuster_modele_mixte(
        df, meilleure_transfo, reml=True,
        variables_supplementaires=variables_supplementaires,
    )
    print(f"\n  Type de modele retenu : {type_modele}")
    print(f"  Convergence : {resultat.converged}")
    print("\n" + resultat.summary().as_text())

    print("\n" + "=" * 80)
    print("ETAPE 5 : Diagnostics")
    print("=" * 80)
    calculer_diagnostics(resultat, df_modele)
    verifier_heteroscedasticite(resultat, df_modele)

    print("\n" + "=" * 80)
    print("ETAPE 6 : Interpretation clinique")
    print("=" * 80)
    suivi_max_observe = df_modele["temps_annees"].max()
    interpreter_effet_clinique(resultat, meilleure_transfo,
                                horizons_annees=horizons_annees,
                                suivi_max_observe=suivi_max_observe)

    print("\n" + "=" * 80)
    print("ETAPE 7 : Visualisation")
    print("=" * 80)
    tracer_trajectoires(df_modele, resultat, meilleure_transfo)

    print("\n" + "=" * 80)
    print("ETAPE 8 : Analyse de sensibilite ordinale (limite documentee)")
    print("=" * 80)
    resultats_ordinal = analyse_sensibilite_ordinale(df_modele)

    return resultat, df_modele, resultats_ordinal

if __name__ == "__main__":
    CHEMIN_CSV = "registre_sep_pediatrique.csv"

    HORIZONS_CLINIQUES = (2, 5, 10)

    resultat, df_final, sensibilite_ordinale = analyse_complete(
        CHEMIN_CSV,
        fenetre_post_poussee_mois=None,  
        variables_supplementaires=None,
        horizons_annees=HORIZONS_CLINIQUES,
    )

    # --- Option B : modele ajuste -- recuperation + covariable(s) -----------
    # Active par defaut. A desactiver (mettre en commentaire) si
    # l'encadrante ne souhaite QUE le modele univarie de l'Option A.
    # Variables disponibles : "severite_poussee", "age_diagnostic", "sexe",
    # "traitement_dmt" (voir VARIABLES_SUPPLEMENTAIRES_AUTORISEES pour la
    # reference de chacune -- toute autre variable est refusee tant
    # qu'elle n'est pas ajoutee consciemment avec sa source
    # bibliographique). Protege par un garde-fou explicite : si les
    # colonnes attendues (ex. severite_poussee, age_diagnostic_annees) ne sont
    # pas encore presentes dans votre extraction du registre, le script
    # le signale clairement au lieu de planter tout le pipeline.
    VARIABLES_AJUSTEMENT = ["severite_poussee", "age_diagnostic"]
    try:
        resultat_ajuste, df_final_ajuste, sensibilite_ordinale_ajustee = analyse_complete(
            CHEMIN_CSV,
            fenetre_post_poussee_mois=None,
            variables_supplementaires=VARIABLES_AJUSTEMENT,
            horizons_annees=HORIZONS_CLINIQUES,
        )
    except ValueError as e:
        print(f"\n[OPTION B NON EXECUTEE] {e}\n"
              f"-> Le modele univarie (Option A) reste la reference tant "
              f"que ces colonnes ne sont pas dans l'extraction du "
              f"registre. Ajouter les colonnes manquantes au CSV, ou "
              f"retirer la variable non disponible de "
              f"VARIABLES_AJUSTEMENT ci-dessus, puis relancer.")

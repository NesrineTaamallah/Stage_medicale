import os
import math
from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine

from dotenv import load_dotenv
load_dotenv()

from registry import ANALYSES  # registre de toutes les analyses SEP/EPR

app = FastAPI(title="Service d'analyse statistique - NeuroExo-Predict")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://user:password@localhost:5432/registre_neuroexo",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def _assainir(valeur):
    """Remplace récursivement Infinity/-Infinity/NaN par None.

    Python's json.dumps (utilisé par défaut par FastAPI/Starlette) autorise
    ces littéraux (allow_nan=True) et renvoie donc un HTTP 200 "valide" côté
    Python. Mais Infinity/NaN ne sont PAS du JSON standard : le
    fetch(...).json() côté Node (proxy analysisRoutes.js) utilise
    JSON.parse(), qui est strict et lève une erreur sur ces tokens -> la
    requête Node tombe dans son catch générique -> "Service d'analyse
    indisponible" alors que l'analyse Python a réellement abouti.
    Cas fréquent avec une régression logistique multivariée sur petit
    échantillon : séparation quasi-parfaite -> coefficient énorme ->
    OR = exp(coef) = Infinity.
    """
    if isinstance(valeur, float):
        return None if not math.isfinite(valeur) else valeur
    if isinstance(valeur, dict):
        return {k: _assainir(v) for k, v in valeur.items()}
    if isinstance(valeur, list):
        return [_assainir(v) for v in valeur]
    return valeur


@app.get("/analyses")
def lister_analyses():
    """Liste des analyses disponibles, consommée par le frontend pour
    construire dynamiquement l'onglet 'Analyse statistique'."""
    return [
        {
            "id": key,
            "registre": meta["registre"],
            "titre": meta["titre"],
            "description": meta["description"],
            "parametres": meta["parametres_schema"],  # décrit le formulaire React
        }
        for key, meta in ANALYSES.items()
    ]


@app.post("/analyses/{analyse_id}/run")
def lancer_analyse(analyse_id: str, config: dict):
    if analyse_id not in ANALYSES:
        raise HTTPException(status_code=404, detail=f"Analyse '{analyse_id}' inconnue")

    fonction = ANALYSES[analyse_id]["run"]
    try:
        resultat = fonction(engine, config)
    except ValueError as e:
        # erreurs métier attendues (ex: effectif insuffisant) -> 422, pas 500
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        # Erreurs statistiques imprévues mais légitimes côté données
        # (formule patsy invalide, séparation parfaite du modèle logistique,
        # matrice singulière...) : on les renvoie comme un 422 explicite
        # au lieu de laisser FastAPI crasher -> proxy Node affichant
        # à tort "Service d'analyse indisponible".
        raise HTTPException(
            status_code=422,
            detail=f"Impossible d'ajuster le modèle avec cette configuration "
                   f"({type(e).__name__}: {e}). Réduisez le nombre de "
                   f"covariables ou changez la fenêtre de tolérance.",
        )
    return _assainir(resultat)
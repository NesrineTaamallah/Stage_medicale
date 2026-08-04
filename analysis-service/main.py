"""
Service d'analyse statistique (fenêtre 4 - clinicien).

Ce service isole toute la logique Python (statsmodels/lifelines/scipy) des
13 scripts existants derrière une API HTTP. Le backend Node ne fait que
proxy vers ce service (voir analysisRoutes.js côté Node).

Lancement local :
    pip install fastapi uvicorn sqlalchemy psycopg2-binary pandas numpy \
                statsmodels scipy scikit-learn lifelines matplotlib
    uvicorn main:app --port 8000 --reload

Variable d'environnement attendue :
    DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/registre_neuroexo
"""
import os
from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine

from registry import ANALYSES  # registre de toutes les analyses SEP/EPR

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="Service d'analyse statistique - NeuroExo-Predict")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://user:password@localhost:5432/registre_neuroexo",
)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)


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
    return resultat

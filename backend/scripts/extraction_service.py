"""
extraction_service.py
======================

Microservice FastAPI exposant `extraction_patient.py` en HTTP, pour être
appelé depuis le backend Node.js (dossierUploadController.js /
extractionController.js) sans coupler le process Node au chargement du
modèle LLM (VRAM, dépendances Python/CUDA).

Lancement (port 8003 — 8001/8002 déjà pris par Whisper/PaddleOCR, voir
extractionClient.js côté Node) :
    uvicorn extraction_service:app --host 0.0.0.0 --port 8003

Le modèle est chargé paresseusement (au premier appel), comme dans
extraction_patient.py — donc le premier POST est plus lent (chargement
GPU), les suivants sont rapides. Un endpoint /health permet de vérifier
que le service tourne sans déclencher ce chargement.
"""

import sys

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    import extraction_patient as ep
except Exception as exc:  # ModuleNotFoundError, ImportError CUDA/torch, etc.
    # On ne bloque pas le démarrage d'uvicorn : sans ce garde-fou, une
    # erreur d'import ici tue tout le process et Node reçoit juste
    # "fetch failed" côté extractionClient.js, sans aucun détail utile.
    print(f"[extraction_service] ERREUR au chargement de extraction_patient : {exc}", file=sys.stderr)
    ep = None
    _import_error = str(exc)
else:
    _import_error = None

app = FastAPI(title="Service d'extraction — étape 1 (données non médicales)")


class ExtractionRequest(BaseModel):
    texte: str = Field(..., description="Texte transcrit (OCR ou ASR) à analyser.")
    chunking: bool = Field(True, description="Active le chunking + résolution de coréférence pour les textes longs.")
    verbose: bool = Field(False, description="Journalise le raisonnement du LLM (debug uniquement).")


class ExtractionResponse(BaseModel):
    numero_dossier: str = ""
    nom_prenom: str = ""
    date_naissance: str = ""
    adresse: str = ""
    origine: str = ""
    telephone: str = ""
    cin: str = ""
    num_cnam: str = ""
    nom_prenom_pere: str = ""
    nom_prenom_mere: str = ""
    frere: str = ""
    soeur: str = ""
    autre_antecedent: str = ""


@app.get("/health")
def health():
    """Vérifie que le service répond, sans forcer le chargement du modèle."""
    if ep is None:
        return {"status": "error", "model_loaded": False, "load_error": _import_error}
    return {
        "status": "ok",
        "model_loaded": ep._extractor_model is not None,
        "load_error": ep._model_load_error,
    }


@app.post("/extraire/patient", response_model=ExtractionResponse)
def extraire_patient(req: ExtractionRequest):
    if ep is None:
        # extraction_patient.py n'a pas pu être importé au démarrage du
        # service (dépendance manquante, erreur CUDA...) : on renvoie
        # une 503 explicite plutôt qu'un 500 muet.
        raise HTTPException(
            status_code=503,
            detail=f"Module extraction_patient indisponible : {_import_error}",
        )

    if not req.texte or not req.texte.strip():
        raise HTTPException(status_code=400, detail="Le champ 'texte' est requis et ne peut pas être vide.")

    try:
        resultat = ep.extraire_donnees_patient(req.texte, chunking=req.chunking, verbose=req.verbose)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur pendant l'extraction : {exc}")
    return resultat

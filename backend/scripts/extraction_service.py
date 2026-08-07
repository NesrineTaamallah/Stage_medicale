"""
extraction_service.py
======================

Microservice FastAPI exposant `extraction_patient.py` en HTTP, pour être
appelé depuis le backend Node.js (dossierUploadController.js /
extractionController.js) sans coupler le process Node au chargement du
modèle LLM (VRAM, dépendances Python/CUDA).

Lancement :
    uvicorn extraction_service:app --host 0.0.0.0 --port 8001

Le modèle est chargé paresseusement (au premier appel), comme dans
extraction_patient.py — donc le premier POST est plus lent (chargement
GPU), les suivants sont rapides. Un endpoint /health permet de vérifier
que le service tourne sans déclencher ce chargement.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import extraction_patient as ep

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
    return {"status": "ok", "model_loaded": ep._extractor_model is not None, "load_error": ep._model_load_error}


@app.post("/extraire/patient", response_model=ExtractionResponse)
def extraire_patient(req: ExtractionRequest):
    if not req.texte or not req.texte.strip():
        raise HTTPException(status_code=400, detail="Le champ 'texte' est requis et ne peut pas être vide.")

    resultat = ep.extraire_donnees_patient(req.texte, chunking=req.chunking, verbose=req.verbose)
    return resultat

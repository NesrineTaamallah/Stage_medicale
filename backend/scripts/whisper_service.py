"""
Service HTTP persistant pour la transcription audio (WhisperX + français
médical), pensé pour remplacer l'appel `spawn()` par requête utilisé
jusqu'ici dans dossierUploadController.js.

Pourquoi : whisper_transcribe.py recharge le modèle (large-v3 + modèle
d'alignement, ~2.5 Go à charger en VRAM/RAM) à CHAQUE transcription quand il
est lancé via spawn(), ce qui coûte plusieurs dizaines de secondes par
requête rien qu'au chargement. Ici, le modèle est chargé UNE SEULE FOIS au
démarrage du service (grâce au cache singleton déjà présent dans
transcribe_audio()), et chaque appel HTTP ne fait plus que l'inférence.

Démarrage :
    uvicorn whisper_service:app --host 127.0.0.1 --port 8001

Endpoint :
    POST /transcribe   body JSON: {"audio_path": "chemin/vers/fichier.wav"}
    ->  {"text": "..."}                     si succès
    ->  {"error": "..."} avec HTTP 4xx/5xx  si échec

    GET /health  -> {"status": "ok", "model_loaded": true|false}
"""

import os
import sys

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Réutilise telle quelle toute la logique (chargement .env, singleton
# modèle, post-traitement médical) déjà écrite dans whisper_transcribe.py.
import whisper_transcribe as wt

app = FastAPI(title="Whisper Transcription Service")


class TranscribeRequest(BaseModel):
    audio_path: str


class TranscribeResponse(BaseModel):
    text: str


@app.on_event("startup")
def _preload_model():
    """Charge le modèle dès le démarrage du service (au lieu d'attendre la
    première requête), pour que la première transcription réelle soit déjà
    rapide elle aussi."""
    try:
        print("[INFO] Préchargement du modèle Whisper au démarrage...", file=sys.stderr)
        wt._load_models()
        print("[INFO] Modèle prêt, service opérationnel.", file=sys.stderr)
    except Exception as e:
        # On ne bloque pas le démarrage du service si le préchargement
        # échoue (ex: pas de GPU dispo au boot) — le modèle sera rechargé
        # (ou l'erreur re-levée) à la première vraie requête.
        print(f"[WARN] Préchargement du modèle échoué : {e}", file=sys.stderr)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": bool(wt._MODEL_CACHE)}


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(req: TranscribeRequest):
    if not os.path.isfile(req.audio_path):
        raise HTTPException(status_code=404, detail=f"Fichier audio introuvable : {req.audio_path}")

    try:
        text = wt.transcribe_audio(req.audio_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription échouée : {e}")

    return {"text": text}

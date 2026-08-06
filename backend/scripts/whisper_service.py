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

    GET /health  -> {"status": "ok", "model_loaded": true|false, "ready": true|false}
"""

import os
import sys
import traceback

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Réutilise telle quelle toute la logique (chargement .env, singleton
# modèle, post-traitement médical) déjà écrite dans whisper_transcribe.py.
import whisper_transcribe as wt

app = FastAPI(title="Whisper Transcription Service")

# Flag explicite, mis à True seulement quand _load_models() est ENTIEREMENT
# terminé (téléchargement HF inclus). Corrige la race condition observée :
# uvicorn annonçait "Application startup complete" / acceptait déjà des
# requêtes alors que le modèle d'alignement (~1.26 Go) était encore en
# téléchargement en arrière-plan -> transcribe_audio() tombait sur un
# modèle incomplet -> 500 sans cause claire dans les logs.
_MODEL_READY = False


@app.on_event("startup")
def _preload_model():
    """Charge le modèle dès le démarrage du service (au lieu d'attendre la
    première requête), pour que la première transcription réelle soit déjà
    rapide elle aussi."""
    global _MODEL_READY
    try:
        print("[INFO] Préchargement du modèle Whisper au démarrage...", file=sys.stderr)
        wt._load_models()
        _MODEL_READY = True
        print("[INFO] Modèle prêt, service opérationnel.", file=sys.stderr)
    except Exception:
        # On ne bloque pas le démarrage du service si le préchargement
        # échoue (ex: pas de GPU dispo au boot) — le modèle sera rechargé
        # (ou l'erreur re-levée) à la première vraie requête.
        # On loggue la stacktrace complète : un simple f"{e}" masque souvent
        # la cause réelle (erreurs HF Hub, CUDA OOM, etc.).
        print("[WARN] Préchargement du modèle échoué :", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


class TranscribeRequest(BaseModel):
    audio_path: str


class TranscribeResponse(BaseModel):
    text: str


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": bool(wt._MODEL_CACHE),
        "ready": _MODEL_READY,
    }


@app.post("/transcribe", response_model=TranscribeResponse)
def transcribe(req: TranscribeRequest):
    if not _MODEL_READY:
        # Empêche d'arriver dans transcribe_audio() alors que le modèle
        # d'alignement est encore en cours de téléchargement/chargement.
        raise HTTPException(
            status_code=503,
            detail="Modèle en cours de chargement, réessayez dans quelques instants (voir /health).",
        )

    if not os.path.isfile(req.audio_path):
        raise HTTPException(status_code=404, detail=f"Fichier audio introuvable : {req.audio_path}")

    try:
        text = wt.transcribe_audio(req.audio_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        # Stacktrace complète dans les logs serveur pour un vrai diagnostic ;
        # message court dans la réponse HTTP.
        print("[ERROR] Échec de la transcription :", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Transcription échouée : {e}")

    return {"text": text}
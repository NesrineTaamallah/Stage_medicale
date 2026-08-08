
import os
import sys
import traceback

from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


import whisper_transcribe as wt

app = FastAPI(title="Whisper Transcription Service")


_MODEL_READY = False


@app.on_event("startup")
def _preload_model():
    
    global _MODEL_READY
    try:
        print("[INFO] Préchargement du modèle Whisper au démarrage...", file=sys.stderr)
        wt._load_models()
        _MODEL_READY = True
        print("[INFO] Modèle prêt, service opérationnel.", file=sys.stderr)
    except Exception:
        
        print("[WARN] Préchargement du modèle échoué :", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


class TranscribeRequest(BaseModel):
    audio_path: str


class WordConfidence(BaseModel):
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    score: float           
    confidence: str        


class TranscribeResponse(BaseModel):
    text: str
    words: List[WordConfidence] = []


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
        
        raise HTTPException(
            status_code=503,
            detail="Modèle en cours de chargement, réessayez dans quelques instants (voir /health).",
        )

    if not os.path.isfile(req.audio_path):
        raise HTTPException(status_code=404, detail=f"Fichier audio introuvable : {req.audio_path}")

    try:
        result = wt.transcribe_audio(req.audio_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        
        print("[ERROR] Échec de la transcription :", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Transcription échouée : {e}")

    return result
"""
Service HTTP persistant pour l'OCR des documents scannés (PaddleOCR-VL),
même principe que whisper_service.py : le pipeline PaddleOCR-VL est chargé
UNE SEULE FOIS au démarrage (au lieu d'être rechargé à chaque appel via
spawn()), ce qui évite plusieurs dizaines de secondes de rechargement de
modèle par document.

Démarrage :
    uvicorn paddleocr_service:app --host 127.0.0.1 --port 8002

Endpoint :
    POST /ocr   body JSON: {"input_path": "chemin/vers/scan.pdf", "out_dir": null}
    ->  {"markdown": "...", "md_path": "...", "qc_alerts": [...], "n_pages": N}

    GET /health -> {"status": "ok", "pipeline_loaded": true|false}

Ajouts par rapport à la version initiale :
- Verrou global (_ocr_lock) : une seule transcription à la fois sur le CPU.
  Les requêtes suivantes attendent leur tour au lieu de se battre pour le
  même CPU, ce qui évite un ralentissement global.
- Timeout serveur (OCR_TIMEOUT_SECONDS) : renvoie une 504 claire au lieu de
  laisser le client (curl, frontend, etc.) attendre indéfiniment.
- Logs de timing à chaque étape (attente du verrou, durée de traitement)
  pour distinguer facilement "c'est lent" de "c'est bloqué".
"""

import os

# IMPORTANT : doit être défini AVANT l'import de paddleocr_transcribe / paddle,
# sinon la variable n'a aucun effet (Paddle lit ces variables au chargement
# de la librairie). Ne modifie ni le modèle ni la logique OCR : ça se contente
# d'autoriser Paddle à utiliser plusieurs cœurs CPU au lieu d'un seul.
os.environ.setdefault("OMP_NUM_THREADS", "8")  # ajuste selon ton nombre de cœurs

import sys
import time
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from threading import Lock
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Réutilise telle quelle la logique déjà écrite dans paddleocr_transcribe.py
# (prétraitement, upscaling, OCR, nettoyage markdown, singleton pipeline).
import paddleocr_transcribe as pt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("paddleocr_service")

app = FastAPI(title="PaddleOCR-VL Service")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

OCR_TIMEOUT_SECONDS = 1800  # 30 min max par requête, ajuste selon ce que tu observes

# Une seule transcription à la fois : le CPU ne peut de toute façon pas
# faire tourner deux inférences PaddleOCR-VL efficacement en parallèle.
_ocr_lock = Lock()

# Executor séparé pour pouvoir imposer un timeout dur sur transcribe_scan
# (Lock.acquire seul ne permet pas d'interrompre l'appel en cours).
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr-worker")


class OcrRequest(BaseModel):
    input_path: str
    out_dir: Optional[str] = None
    md_out: Optional[str] = None


class OcrResponse(BaseModel):
    markdown: str
    md_path: str
    qc_alerts: List[dict]
    n_pages: int


@app.on_event("startup")
def _preload_pipeline():
    """Charge le pipeline PaddleOCR-VL dès le démarrage du service, pour que
    la première requête réelle soit déjà rapide elle aussi."""
    try:
        logger.info("Préchargement de PaddleOCR-VL au démarrage...")
        pt._load_pipeline()
        logger.info("Pipeline prêt, service opérationnel.")
    except Exception as e:
        # Ne bloque pas le démarrage : le pipeline sera rechargé (ou
        # l'erreur re-levée) à la première vraie requête.
        logger.warning(f"Préchargement du pipeline échoué : {e}")


@app.get("/health")
def health():
    return {"status": "ok", "pipeline_loaded": bool(pt._PIPELINE_CACHE)}


@app.post("/ocr", response_model=OcrResponse)
def ocr(req: OcrRequest):
    if not os.path.isfile(req.input_path):
        raise HTTPException(status_code=404, detail=f"Fichier introuvable : {req.input_path}")

    t_submitted = time.time()
    logger.info(f"[OCR] Requête reçue : {req.input_path} (en attente du verrou...)")

    future = _executor.submit(_run_transcribe, req)

    try:
        result = future.result(timeout=OCR_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        elapsed = time.time() - t_submitted
        logger.error(f"[OCR] Timeout après {elapsed:.1f}s pour {req.input_path}")
        raise HTTPException(
            status_code=504,
            detail=f"Le traitement OCR a dépassé {OCR_TIMEOUT_SECONDS}s "
                   f"({req.input_path}). Le traitement continue en arrière-plan "
                   f"mais la réponse n'a pas pu être retournée à temps.",
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception(f"[OCR] Échec pour {req.input_path}")
        raise HTTPException(status_code=500, detail=f"OCR échoué : {e}")

    return result


def _run_transcribe(req: OcrRequest) -> dict:
    """Exécuté dans le worker unique : acquiert le verrou, transcrit,
    logue les durées, écrit le markdown."""
    t_wait_start = time.time()
    with _ocr_lock:
        wait_duration = time.time() - t_wait_start
        if wait_duration > 1:
            logger.info(f"[OCR] Attente du verrou : {wait_duration:.1f}s pour {req.input_path}")

        t0 = time.time()
        logger.info(f"[OCR] Début transcription : {req.input_path}")
        result = pt.transcribe_scan(req.input_path, out_dir=req.out_dir)
        logger.info(f"[OCR] Transcription terminée en {time.time() - t0:.1f}s ({req.input_path})")

    markdown_text = result["markdown"]
    md_out_path = Path(req.md_out) if req.md_out else Path(req.input_path).with_suffix(".md")
    try:
        md_out_path.write_text(markdown_text, encoding="utf-8")
    except Exception as e:
        logger.warning(f"Impossible d'écrire le fichier .md ({md_out_path}) : {e}")

    return {
        "markdown": markdown_text,
        "md_path": str(md_out_path),
        "qc_alerts": result["qc_alerts"],
        "n_pages": result["n_pages"],
    }
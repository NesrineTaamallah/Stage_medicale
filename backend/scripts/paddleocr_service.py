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
"""

import os
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Réutilise telle quelle la logique déjà écrite dans paddleocr_transcribe.py
# (prétraitement, upscaling, OCR, nettoyage markdown, singleton pipeline).
import paddleocr_transcribe as pt

app = FastAPI(title="PaddleOCR-VL Service")


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
        print("[INFO] Préchargement de PaddleOCR-VL au démarrage...", file=sys.stderr)
        pt._load_pipeline()
        print("[INFO] Pipeline prêt, service opérationnel.", file=sys.stderr)
    except Exception as e:
        # Ne bloque pas le démarrage : le pipeline sera rechargé (ou
        # l'erreur re-levée) à la première vraie requête.
        print(f"[WARN] Préchargement du pipeline échoué : {e}", file=sys.stderr)


@app.get("/health")
def health():
    return {"status": "ok", "pipeline_loaded": bool(pt._PIPELINE_CACHE)}


@app.post("/ocr", response_model=OcrResponse)
def ocr(req: OcrRequest):
    if not os.path.isfile(req.input_path):
        raise HTTPException(status_code=404, detail=f"Fichier introuvable : {req.input_path}")

    try:
        result = pt.transcribe_scan(req.input_path, out_dir=req.out_dir)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR échoué : {e}")

    markdown_text = result["markdown"]
    md_out_path = Path(req.md_out) if req.md_out else Path(req.input_path).with_suffix(".md")
    try:
        md_out_path.write_text(markdown_text, encoding="utf-8")
    except Exception as e:
        print(f"[WARN] Impossible d'écrire le fichier .md ({md_out_path}) : {e}", file=sys.stderr)

    return {
        "markdown": markdown_text,
        "md_path": str(md_out_path),
        "qc_alerts": result["qc_alerts"],
        "n_pages": result["n_pages"],
    }

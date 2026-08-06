# Service OCR PaddleOCR-VL (persistant)

Même principe que `whisper_service.py` (voir README_whisper_service.md) :
le pipeline PaddleOCR-VL (~plusieurs Go, GPU) est chargé **une seule fois**
au démarrage du service au lieu d'être rechargé à chaque document scanné.
`dossierUploadController.js` l'appelle en priorité pour `type_entree ===
'scan'`, et ne retombe sur `spawn()` que si ce service n'est pas démarré.

## Installation

Recommandé : venv **séparé** de celui de Whisper (`venv-paddleocr`), car
`paddlepaddle-gpu` et `torch`/`whisperx` peuvent entrer en conflit sur les
mêmes versions CUDA/cuDNN.

```powershell
cd backend
python -m venv venv-paddleocr
.\venv-paddleocr\Scripts\Activate.ps1
pip install paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
pip install "paddleocr[doc-parser]>=3.6.0" opencv-python pymupdf beautifulsoup4 python-dotenv fastapi "uvicorn[standard]"
```

(Adapte l'index `cu126` à ta version CUDA, voir cellule 1-2 du notebook
d'origine pour la détection automatique.)

## Démarrage du service

Dans un terminal **séparé**, à laisser tourner en continu à côté de
`npm run dev` (et du service Whisper si tu transcris aussi de l'audio) :

```powershell
cd backend
.\venv-paddleocr\Scripts\Activate.ps1
cd scripts
uvicorn paddleocr_service:app --host 127.0.0.1 --port 8002
```

Attends `[INFO] Pipeline prêt, service opérationnel.` avant de tester un
upload de scan, sinon la première requête attend elle-même le chargement.

Vérifier que le service tourne :
```
GET http://127.0.0.1:8002/health
-> {"status": "ok", "pipeline_loaded": true}
```

## Côté Node

Rien à faire par défaut : `dossierUploadController.js` appelle
`http://127.0.0.1:8002` automatiquement pour `type_entree === 'scan'`.
Pour changer le port/host, ajoute dans `backend/.env` :

```
PADDLEOCR_SERVICE_URL=http://127.0.0.1:8002
```

Si tu utilises un venv séparé de celui de Whisper et veux garder le repli
`spawn()` fonctionnel lui aussi, précise le binaire Python dédié :

```
PADDLEOCR_PYTHON_BIN=C:\...\venv-paddleocr\Scripts\python.exe
```

## En résumé, à chaque session de dev (upload audio + scan) :

1. `uvicorn whisper_service:app --port 8001` (venv-whisper)
2. `uvicorn paddleocr_service:app --port 8002` (venv-paddleocr)
3. `npm run dev` (backend)

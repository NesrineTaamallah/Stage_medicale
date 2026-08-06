# Service de transcription Whisper (persistant)

Avant (spawn par requête) : le modèle (~2.5 Go) est rechargé à **chaque**
transcription -> plusieurs dizaines de secondes perdues par fichier.

Maintenant : `whisper_service.py` charge le modèle **une seule fois** au
démarrage, puis répond aux requêtes en HTTP. `dossierUploadController.js`
l'appelle en priorité, et ne retombe sur l'ancien mode `spawn()` que si ce
service n'est pas démarré (aucune casse si tu oublies de le lancer, juste
plus lent).

## Installation (dans ton venv existant, ex. venv-whisper)

```powershell
cd backend
.\venv-whisper\Scripts\Activate.ps1
pip install fastapi "uvicorn[standard]"
```

## Démarrage du service

Dans un terminal **séparé**, à laisser tourner en continu à côté de
`npm run dev` :

```powershell
cd backend
.\venv-whisper\Scripts\Activate.ps1
cd scripts
uvicorn whisper_service:app --host 127.0.0.1 --port 8001
```

Le modèle se charge au démarrage (regarde les logs `[INFO] Chargement du
modèle...` / `[INFO] Modèle prêt, service opérationnel.`) — attends que ce
soit affiché avant de tester une transcription, sinon la toute première
requête attendra elle-même le chargement.

Vérifier que le service tourne :
```
GET http://127.0.0.1:8001/health
-> {"status": "ok", "model_loaded": true}
```

## Côté Node

Rien à faire par défaut : `dossierUploadController.js` appelle
`http://127.0.0.1:8001` automatiquement. Pour changer le port/host,
ajoute dans `backend/.env` :

```
WHISPER_SERVICE_URL=http://127.0.0.1:8001
```

## En résumé, à chaque session de dev, deux process à lancer :

1. `uvicorn whisper_service:app --port 8001` (dans `backend/scripts`, venv activé)
2. `npm run dev` (dans `backend`)

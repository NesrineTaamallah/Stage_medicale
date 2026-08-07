"""
extraction_patient.py
======================

Extraction des données non médicales du patient (numero_dossier, nom_prenom,
date_naissance, adresse, origine, telephone, cin, num_cnam, nom_prenom_pere,
nom_prenom_mere, frere, soeur, autre_antecedent) à partir d'un texte
transcrit (OCR ou ASR), via Qwen3-8B quantizé 4-bit.

⚠️ Squelette de reconstruction : ce fichier n'existait pas dans le repo
GitHub (seul extraction_service.py, qui l'importe, y était). Si tu as déjà
une version plus avancée de ce fichier en local (chunking, résolution de
coréférence par union-find, mécanisme anti-boucle, double sortie de
correction...), REMPLACE le contenu ci-dessous par le tien : seule la
forme de l'interface (noms des globales et de la fonction) doit rester
compatible avec extraction_service.py.

Chargement paresseux : le modèle n'est chargé qu'au premier appel à
extraire_donnees_patient(), pas à l'import du module — ainsi /health peut
répondre tout de suite sans déclencher le chargement GPU.
"""

import json
import re
import threading

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

MODEL_NAME = "Qwen/Qwen3-8B"

CHAMPS = [
    "numero_dossier", "nom_prenom", "date_naissance", "adresse", "origine",
    "telephone", "cin", "num_cnam", "nom_prenom_pere", "nom_prenom_mere",
    "frere", "soeur", "autre_antecedent",
]

# État global lu par /health dans extraction_service.py — NE PAS renommer.
_extractor_model = None
_extractor_tokenizer = None
_model_load_error = None
_load_lock = threading.Lock()

SYSTEM_PROMPT = (
    "Tu es un système d'extraction d'informations d'identification patient "
    "à partir de documents médicaux pédiatriques tunisiens (texte OCR ou "
    "transcription audio, potentiellement bruité). "
    "Réponds UNIQUEMENT avec un objet JSON contenant exactement ces clés : "
    f"{', '.join(CHAMPS)}. "
    "Utilise une chaîne vide \"\" pour tout champ absent du texte. "
    "N'invente jamais de valeur. Pas de texte hors JSON, pas de balises markdown."
)


def _charger_modele():
    """Charge Qwen3-8B en 4-bit (NF4) sur GPU. Idempotent et thread-safe."""
    global _extractor_model, _extractor_tokenizer, _model_load_error

    if _extractor_model is not None or _model_load_error is not None:
        return

    with _load_lock:
        if _extractor_model is not None or _model_load_error is not None:
            return
        try:
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
            )
            tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_NAME,
                quantization_config=bnb_config,
                device_map="auto",
                torch_dtype=torch.float16,
            )
            _extractor_tokenizer = tokenizer
            _extractor_model = model
        except Exception as exc:
            # Cas fréquent sur RTX 3050 6 Go : OOM si un autre service GPU
            # (Whisper/PaddleOCR) tourne déjà. On mémorise l'erreur pour ne
            # pas retenter le chargement à chaque requête, et /health la
            # remonte telle quelle.
            _model_load_error = str(exc)
            raise


def _extraire_json(texte_genere: str) -> dict:
    """Isole le premier objet JSON valide dans la sortie brute du modèle."""
    match = re.search(r"\{.*\}", texte_genere, re.DOTALL)
    if not match:
        raise ValueError("Aucun JSON trouvé dans la sortie du modèle.")
    return json.loads(match.group(0))


def _normaliser(resultat: dict) -> dict:
    """Garantit que tous les champs attendus sont présents (chaîne vide sinon)."""
    return {champ: str(resultat.get(champ, "") or "").strip() for champ in CHAMPS}


def extraire_donnees_patient(texte: str, chunking: bool = True, verbose: bool = False) -> dict:
    """
    Point d'entrée appelé par extraction_service.py (POST /extraire/patient).

    NOTE : ce squelette ne fait qu'un seul passage sur le texte complet.
    Le chunking + résolution de coréférence par union-find (pour les textes
    longs multi-documents) mentionnés dans le contexte du projet ne sont
    PAS reconstruits ici — à réintégrer depuis ta version originale si tu
    l'as développée ailleurs.
    """
    _charger_modele()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": texte},
    ]
    prompt = _extractor_tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = _extractor_tokenizer(prompt, return_tensors="pt").to(_extractor_model.device)

    with torch.no_grad():
        sortie = _extractor_model.generate(
            **inputs,
            max_new_tokens=512,
            do_sample=False,
            temperature=None,
            top_p=None,
        )

    texte_genere = _extractor_tokenizer.decode(
        sortie[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True
    )
    if verbose:
        print(f"[extraction_patient] sortie brute du modèle :\n{texte_genere}")

    try:
        resultat = _extraire_json(texte_genere)
    except (ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Sortie du modèle non parsable en JSON : {exc}") from exc

    return _normaliser(resultat)

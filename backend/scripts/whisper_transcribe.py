import argparse
import gc
import io
import json
import os
import re
import sys
from collections import Counter
from difflib import SequenceMatcher

# Force stdout/stderr en UTF-8 : sur Windows, quand ce script est lancé via
# spawn() (sortie redirigée vers un pipe, pas une vraie console), Python
# retombe sur l'encodage de la page de code Windows (souvent cp1252) au
# lieu d'UTF-8. Les caractères accentués (é, è, à...) sont alors remplacés
# par le caractère de substitution "�" au moment même de l'impression —
# la transcription elle-même est correcte, seule la sortie stdout est
# corrompue. C'est ce texte déjà corrompu qui finit stocké en base.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)

from dotenv import load_dotenv

# Charge les variables du fichier .env (doit contenir HF_TOKEN=hf_xxx).
# On résout explicitement le chemin par rapport à ce script (dossier parent
# = backend/), car load_dotenv() sans argument cherche depuis le cwd du
# process appelant — quand ce script est lancé via spawn() depuis Node,
# ce cwd n'est pas forcément backend/, et le .env ne serait alors jamais
# trouvé (d'où un 401/404 Hugging Face qui n'apparaît qu'en lancement Node,
# jamais en terminal où le cwd est déjà backend/).
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(dotenv_path=_ENV_PATH)

_HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
if _HF_TOKEN:
    # huggingface_hub lit cette variable pour s'authentifier automatiquement,
    # sans passer par `huggingface-cli login`.
    os.environ["HUGGINGFACE_HUB_TOKEN"] = _HF_TOKEN
    os.environ["HF_TOKEN"] = _HF_TOKEN

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL_NAME = "nesrine56/whisper-large-v3-ct2"
ALIGN_MODEL_NAME = "jonatasgrosman/wav2vec2-large-xlsr-53-french"
LANGUAGE = "fr"
# Réduit de 4 à 2 : sur un GPU 6 Go (ex. RTX 3050), un batch_size=4 laisse
# trop peu de marge une fois le modèle d'alignement chargé en plus du
# modèle ASR, provoquant des CUDA OOM sur les fichiers audio un peu longs.
BATCH_SIZE = 2

DOMAIN_PROMPT = (
    "Compte-rendu médical dicté en français. Antécédents personnels et familiaux, "
    "motif de consultation, examen clinique, signes fonctionnels, diagnostic, "
    "bilan biologique et radiologique, IRM, scanner, échographie, ECG, EEG, "
    "hospitalisation, évolution clinique, surveillance, consultation de suivi. "
    "Exemple de posologie : traitement par 20 mg/kg/jour en 2 prises, "
    "amoxicilline 500 mg 3 x/jour pendant 7 jours, dose de charge de 15 mg/kg."
)

ASR_OPTIONS = {
    "temperatures": [0.0],
    "initial_prompt": DOMAIN_PROMPT,
    "no_speech_threshold": 0.5,
    "compression_ratio_threshold": 2.2,
    "log_prob_threshold": -0.8,
    "condition_on_previous_text": False,
    "beam_size": 5,
    "patience": 1.0,
    "suppress_numerals": False,
}

VAD_OPTIONS = {
    "vad_onset": 0.3,
    "vad_offset": 0.363,
}

# Règles de correction lexicale (regex, remplacement) — vide par défaut,
# à compléter au besoin (ex. homophones Whisper récurrents identifiés en
# pratique : "Sousse" -> "poussée", "gadoline" -> "gadolinium", etc.)
CORRECTION_RULES = []

FR_NUM_WORDS_FOIS = {
    "deux": "2", "trois": "3", "quatre": "4",
    "cinq": "5", "six": "6", "sept": "7", "huit": "8", "neuf": "9", "dix": "10",
}


# ---------------------------------------------------------------------------
# Post-traitement (repris tel quel du notebook)
# ---------------------------------------------------------------------------

def detect_ngram_repetition(text, n=5, max_repeat=3):
    """Détecte les boucles d'hallucination (n-gramme répété trop souvent)."""
    words = re.findall(r"\w+", text.lower())
    if len(words) < n * 2:
        return False, None
    ngrams = [" ".join(words[i:i + n]) for i in range(len(words) - n + 1)]
    counts = Counter(ngrams)
    for ngram, count in counts.items():
        if count > max_repeat:
            return True, ngram
    return False, None


def dedup_consecutive_segments(segments, similarity_threshold=0.9):
    """Supprime les segments consécutifs quasi identiques et les boucles."""
    cleaned = []
    for seg in segments:
        text = seg["text"].strip()

        has_loop, ngram = detect_ngram_repetition(text)
        if has_loop:
            print(f"  [WARN] Boucle détectée ({seg['start']:.2f}s) : '{ngram}' répété. Segment ignoré.")
            continue

        if cleaned:
            prev_text = cleaned[-1]["text"].strip()
            ratio = SequenceMatcher(None, text.lower(), prev_text.lower()).ratio()
            if ratio > similarity_threshold and len(text) > 0:
                continue

        cleaned.append(seg)
    return cleaned


def apply_corrections(text, rules=CORRECTION_RULES):
    corrected = text
    for pattern, replacement in rules:
        corrected = re.sub(pattern, replacement, corrected, flags=re.IGNORECASE)
    return corrected


def normalize_medical(text):
    """Normalise les nombres écrits en toutes lettres et les unités médicales."""
    from text_to_num import alpha2digit

    text = re.sub(r"\bune\b", "ZZZARTFEMZZZ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bun\b", "ZZZARTMASZZZ", text, flags=re.IGNORECASE)

    text = re.sub(r"\bpoint\s+d[\'’]?\s*interrogation\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bpoint\s+d[\'’]?\s*exclamation\b", "", text, flags=re.IGNORECASE)

    text = alpha2digit(text, "fr", threshold=0)

    text = re.sub(r"ZZZARTFEMZZZ", "une", text, flags=re.IGNORECASE)
    text = re.sub(r"ZZZARTMASZZZ", "un", text, flags=re.IGNORECASE)

    for word, digit in FR_NUM_WORDS_FOIS.items():
        text = re.sub(rf"\b{word}\s+fois\b", f"{digit} fois", text, flags=re.IGNORECASE)

    text = re.sub(r"(\d+)\s*fois\s*(?=\d)", r"\1 * ", text)

    unit_map = [
        (r"\bmilligrammes?\b", "mg"), (r"\bkilogrammes?\b", "kg"), (r"\bmicrogrammes?\b", "ug"),
        (r"\bgrammes?\b", "g"),
        (r"\bmillilitres?\b", "ml"), (r"\blitres?\b", "l"),
    ]
    for pattern, repl in unit_map:
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)

    text = re.sub(r"(\d)(mg|g|kg|ug|ml|l)\b", r"\1 \2", text)
    return text


# ---------------------------------------------------------------------------
# Chargement du modèle (singleton — coûteux, à ne faire qu'une fois par process)
# ---------------------------------------------------------------------------

_MODEL_CACHE = {}


def _load_models():
    """Charge (une seule fois) le modèle ASR WhisperX + le modèle d'alignement FR."""
    if _MODEL_CACHE:
        return _MODEL_CACHE["model"], _MODEL_CACHE["model_a"], _MODEL_CACHE["metadata_a"], _MODEL_CACHE["device"]

    import torch
    import whisperx

    # Fixe explicitement l'index de device CUDA AVANT tout appel torch.cuda.* :
    # sur certaines machines (GPU hybride iGPU/dGPU, ou contexte CUDA laissé
    # dans un état incohérent par un process précédent), l'index 0 par défaut
    # peut ne plus correspondre au bon GPU -> "invalid device ordinal".
    device = "cpu"
    if torch.cuda.is_available():
        try:
            torch.cuda.set_device(0)
            device = "cuda"
        except Exception as e:
            print(f"[WARN] GPU CUDA indisponible ({e}), bascule sur CPU.", file=sys.stderr)
            device = "cpu"

    # int8 (au lieu de int8_float16) réduit encore l'empreinte VRAM — utile
    # sur les GPU 6 Go (ex. RTX 3050) où le modèle d'alignement + les buffers
    # d'inférence peuvent facilement dépasser la mémoire disponible.
    compute_type = "int8" if device == "cuda" else "int8"

    print(f"[INFO] Chargement du modèle {MODEL_NAME} ({device}, {compute_type})...", file=sys.stderr)
    try:
        model = whisperx.load_model(
            MODEL_NAME,
            device=device,
            compute_type=compute_type,
            language=LANGUAGE,
            asr_options=ASR_OPTIONS,
            vad_options=VAD_OPTIONS,
        )
    except RuntimeError as e:
        # OOM ou erreur CUDA au chargement -> on retombe sur CPU plutôt que
        # de planter tout le service (plus lent, mais fonctionnel).
        if device == "cuda" and ("CUDA" in str(e) or "cuda" in str(e).lower()):
            print(f"[WARN] Échec chargement GPU ({e}). Repli sur CPU.", file=sys.stderr)
            torch.cuda.empty_cache()
            device = "cpu"
            compute_type = "int8"
            model = whisperx.load_model(
                MODEL_NAME,
                device=device,
                compute_type=compute_type,
                language=LANGUAGE,
                asr_options=ASR_OPTIONS,
                vad_options=VAD_OPTIONS,
            )
        else:
            raise

    print(f"[INFO] Chargement du modèle d'alignement ({ALIGN_MODEL_NAME})...", file=sys.stderr)
    model_a, metadata_a = whisperx.load_align_model(
        language_code=LANGUAGE,
        device=device,
        model_name=ALIGN_MODEL_NAME,
    )

    print("[INFO] Modèles chargés.", file=sys.stderr)

    _MODEL_CACHE.update({"model": model, "model_a": model_a, "metadata_a": metadata_a, "device": device})
    return model, model_a, metadata_a, device


# ---------------------------------------------------------------------------
# Fonction principale
# ---------------------------------------------------------------------------

def _segment_asr_confidence(seg: dict) -> float:
    """Convertit avg_logprob (log-proba, négatif) + no_speech_prob d'un
    segment ASR en une confiance unique dans [0, 1].

    exp(avg_logprob) approxime la probabilité moyenne des tokens du
    segment ; on la pénalise par (1 - no_speech_prob) pour refléter le
    doute du modèle sur la présence même de parole à cet endroit.
    """
    import math

    avg_logprob = seg.get("avg_logprob")
    no_speech_prob = seg.get("no_speech_prob", 0.0) or 0.0

    if avg_logprob is None:
        base = 0.75  # valeur neutre si l'info n'est pas dispo (ex. après align)
    else:
        base = math.exp(avg_logprob)  # avg_logprob <= 0 -> base in (0, 1]

    conf = base * (1 - no_speech_prob)
    return max(0.0, min(1.0, conf))


def _confidence_level(score: float) -> str:
    """Palier de confiance utilisé par le frontend pour la coloration."""
    if score >= 0.85:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


def transcribe_audio(audio_path: str) -> dict:
    """
    Transcrit un fichier audio en texte français nettoyé, avec un score de
    confiance par mot destiné à la coloration côté frontend (rouge/jaune
    pour les mots peu fiables).

    Étapes : ASR WhisperX -> alignement wav2vec2 FR (best effort, donne les
    timestamps + score par mot) -> dédoublonnage des segments -> corrections
    lexicales -> normalisation médicale (nombres, unités).

    Args:
        audio_path: chemin vers le fichier audio (wav, mp3, m4a, flac...).

    Returns:
        dict {
            "text": str,               # texte complet nettoyé
            "words": [                 # confiance par mot, pour coloration frontend
                {
                    "word": str,
                    "start": float | None,
                    "end": float | None,
                    "score": float,         # 0..1
                    "confidence": "high" | "medium" | "low",
                },
                ...
            ],
        }

    Raises:
        FileNotFoundError: si audio_path n'existe pas.
    """
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Fichier audio introuvable : {audio_path}")

    import whisperx

    model, model_a, metadata_a, device = _load_models()

    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=BATCH_SIZE, language=LANGUAGE)

    # Capture la confiance ASR (avg_logprob/no_speech_prob) AVANT l'alignement :
    # whisperx.align() reconstruit les segments et ne conserve pas ces champs.
    asr_conf_by_index = [_segment_asr_confidence(seg) for seg in result["segments"]]

    try:
        aligned = whisperx.align(
            result["segments"], model_a, metadata_a, audio, device,
            return_char_alignments=False,
        )
        segments = aligned["segments"]
        # whisperx.align() garde le même nombre de segments, dans le même
        # ordre -> on peut réattacher la confiance ASR capturée plus haut.
        for i, seg in enumerate(segments):
            seg["_asr_conf"] = asr_conf_by_index[i] if i < len(asr_conf_by_index) else 0.75
        alignment_ok = True
    except Exception as e:
        print(f"[WARN] Alignement indisponible ({e}). Timestamps au niveau segment conservés.", file=sys.stderr)
        segments = result["segments"]
        for i, seg in enumerate(segments):
            seg["_asr_conf"] = asr_conf_by_index[i] if i < len(asr_conf_by_index) else 0.75
        alignment_ok = False

    cleaned_segments = dedup_consecutive_segments(segments)

    # Construit la liste des mots avec score de confiance combiné
    # (50% confiance ASR du segment, 50% confiance d'alignement du mot
    # quand disponible ; sinon 100% confiance ASR du segment).
    words_out = []
    for seg in cleaned_segments:
        asr_conf = seg.get("_asr_conf", 0.75)
        seg_words = seg.get("words") if alignment_ok else None

        if seg_words:
            for w in seg_words:
                align_score = w.get("score")
                if align_score is None:
                    combined = asr_conf
                else:
                    combined = 0.5 * asr_conf + 0.5 * max(0.0, min(1.0, align_score))
                words_out.append({
                    "word": w.get("word", "").strip(),
                    "start": w.get("start"),
                    "end": w.get("end"),
                    "score": round(combined, 3),
                    "confidence": _confidence_level(combined),
                })
        else:
            # Pas d'alignement mot-à-mot dispo -> on retombe sur un score
            # par mot égal à la confiance ASR du segment entier.
            for w in seg.get("text", "").strip().split():
                words_out.append({
                    "word": w,
                    "start": seg.get("start"),
                    "end": seg.get("end"),
                    "score": round(asr_conf, 3),
                    "confidence": _confidence_level(asr_conf),
                })

    full_text = " ".join(seg["text"].strip() for seg in cleaned_segments)
    full_text = apply_corrections(full_text)
    full_text = normalize_medical(full_text)

    gc.collect()
    if device == "cuda":
        try:
            import torch
            # Libère les blocs mémoire mis en cache par PyTorch (buffers
            # d'inférence de la requête précédente) : sans ça, dans le
            # service persistant (whisper_service.py), la VRAM libre tend
            # à diminuer requête après requête jusqu'au CUDA OOM.
            torch.cuda.empty_cache()
        except Exception:
            pass

    return {"text": full_text.strip(), "words": words_out}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Transcrit un fichier audio en texte (WhisperX, français médical).")
    parser.add_argument("--audio", required=True, help="Chemin vers le fichier audio à transcrire.")
    parser.add_argument("--json", action="store_true", help="Sortie au format JSON ({\"text\": ...}) au lieu de texte brut.")
    args = parser.parse_args()

    try:
        result = transcribe_audio(args.audio)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}) if args.json else f"[ERREUR] {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}) if args.json else f"[ERREUR] Transcription échouée : {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(result["text"])


if __name__ == "__main__":
    main()
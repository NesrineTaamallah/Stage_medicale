import argparse
import gc
import io
import json
import os
import re
import sys
from collections import Counter
from difflib import SequenceMatcher

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)

from dotenv import load_dotenv


_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(dotenv_path=_ENV_PATH)

_HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
if _HF_TOKEN:
    
    os.environ["HUGGINGFACE_HUB_TOKEN"] = _HF_TOKEN
    os.environ["HF_TOKEN"] = _HF_TOKEN




MODEL_NAME = os.environ.get("WHISPER_MODEL_PATH") or "nesrine56/whisper-large-v3-ct2"
ALIGN_MODEL_NAME = "jonatasgrosman/wav2vec2-large-xlsr-53-french"
LANGUAGE = "fr"

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


CORRECTION_RULES = []

FR_NUM_WORDS_FOIS = {
    "deux": "2", "trois": "3", "quatre": "4",
    "cinq": "5", "six": "6", "sept": "7", "huit": "8", "neuf": "9", "dix": "10",
}



def detect_ngram_repetition(text, n=5, max_repeat=3):
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




_MODEL_CACHE = {}


def _load_models():
    if _MODEL_CACHE:
        return _MODEL_CACHE["model"], _MODEL_CACHE["model_a"], _MODEL_CACHE["metadata_a"], _MODEL_CACHE["device"]

    import torch
    import whisperx

    
    device = "cpu"
    if torch.cuda.is_available():
        try:
            torch.cuda.set_device(0)
            device = "cuda"
        except Exception as e:
            print(f"[WARN] GPU CUDA indisponible ({e}), bascule sur CPU.", file=sys.stderr)
            device = "cpu"

    
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




def _segment_asr_confidence(seg: dict) -> float:
    
    import math

    avg_logprob = seg.get("avg_logprob")
    no_speech_prob = seg.get("no_speech_prob", 0.0) or 0.0

    if avg_logprob is None:
        base = 0.75  
    else:
        base = math.exp(avg_logprob)  

    conf = base * (1 - no_speech_prob)
    return max(0.0, min(1.0, conf))


def _confidence_level(score: float) -> str:
    if score >= 0.85:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


def transcribe_audio(audio_path: str) -> dict:
    
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Fichier audio introuvable : {audio_path}")

    import whisperx

    model, model_a, metadata_a, device = _load_models()

    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, batch_size=BATCH_SIZE, language=LANGUAGE)

    
    asr_conf_by_index = [_segment_asr_confidence(seg) for seg in result["segments"]]

    try:
        aligned = whisperx.align(
            result["segments"], model_a, metadata_a, audio, device,
            return_char_alignments=False,
        )
        segments = aligned["segments"]
        
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
            
            torch.cuda.empty_cache()
        except Exception:
            pass

    return {"text": full_text.strip(), "words": words_out}



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
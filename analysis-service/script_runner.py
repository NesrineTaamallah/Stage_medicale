"""
Exécuteur générique de scripts d'analyse — ZÉRO modification des fichiers
originaux dans test_analyse_statistique/SEP/ et /EPR/.

Principe (aucune écriture sur disque, jamais) :
  1. On LIT le code source du script original en mémoire (open().read()).
  2. On y substitue, uniquement dans cette chaîne en mémoire, les lignes
     de configuration de la forme "NOM_CONSTANTE = ..." repérées en tête
     de fichier (ex: CONFIG = {...}, DB_URI = "...", ANALYSIS_MODE = "...")
     par la valeur choisie par le clinicien dans le formulaire. Le fichier
     .py sur le disque n'est jamais rouvert en écriture.
  3. On exécute cette chaîne modifiée (compile + exec) dans un namespace
     isolé, avec `input()` redirigé vers une file de réponses pré-remplies
     (pour les quelques scripts qui posent des questions en console),
     `plt.show()` neutralisé (backend Agg) et stdout capturé.
  4. On récupère les figures (.png) écrites dans le dossier de sortie et
     les notes/logs imprimés, pour les renvoyer en JSON au frontend.

C'est l'équivalent programmatique de "lancer le script dans un terminal
et répondre aux questions à sa place" — le fichier reste identique à
celui que vous et votre camarade avez écrit et validé.
"""
import contextlib
import io
import os
import re
import tempfile
import builtins
import matplotlib
matplotlib.use("Agg")


class ReponsesEpuisees(Exception):
    pass


def _input_depuis_file(reponses: list[str]):
    it = iter(reponses)

    def fake_input(prompt=""):
        try:
            return next(it)
        except StopIteration:
            raise ReponsesEpuisees(
                f"Le script attend une réponse supplémentaire (prompt: {prompt!r}) "
                "mais aucune n'a été fournie par le formulaire."
            )
    return fake_input


def _substituer_constantes(source: str, overrides: dict) -> str:
    """Remplace, dans le TEXTE en mémoire uniquement, les lignes
    'NOM = <valeur littérale>' en tête de script par la valeur choisie.
    N'écrit jamais sur le fichier d'origine."""
    for nom, valeur in overrides.items():
        motif = re.compile(rf"^{re.escape(nom)}\s*=.*$", re.MULTILINE)
        remplacement = f"{nom} = {valeur!r}" if not isinstance(valeur, (dict, list)) else f"{nom} = {valeur!r}"
        nouvelle_source, n = motif.subn(remplacement, source, count=1)
        if n == 0:
            raise ValueError(f"Constante '{nom}' introuvable dans le script — vérifier registry.py")
        source = nouvelle_source
    return source


def run_original_script(
    chemin_script: str,
    overrides: dict | None = None,
    reponses_stdin: list[str] | None = None,
    env_overrides: dict | None = None,
) -> dict:
    """
    chemin_script   : chemin vers le .py ORIGINAL, jamais copié ni modifié.
    overrides       : {"NOM_CONSTANTE": valeur} -> injecté en mémoire avant exécution.
    reponses_stdin  : réponses aux éventuels input(), dans l'ordre où ils apparaissent.
    env_overrides   : variables d'environnement (ex: PGHOST, OUTPUT_DIR...).
    """
    overrides = overrides or {}
    reponses_stdin = reponses_stdin or []
    env_overrides = env_overrides or {}

    with open(chemin_script, encoding="utf-8") as f:
        source = f.read()
    source = _substituer_constantes(source, overrides)

    dossier_sortie = tempfile.mkdtemp(prefix="analyse_")
    env_sauvegarde = dict(os.environ)
    os.environ.update(env_overrides)
    os.environ.setdefault("OUTPUT_DIR", dossier_sortie)
    os.environ.setdefault("SEP_OUTPUT_DIR", dossier_sortie)

    stdout_capture = io.StringIO()
    input_original = builtins.input
    builtins.input = _input_depuis_file(reponses_stdin)

    try:
        namespace = {"__name__": "__main__", "__file__": chemin_script}
        with contextlib.redirect_stdout(stdout_capture):
            code = compile(source, chemin_script, "exec")
            exec(code, namespace)
    finally:
        builtins.input = input_original
        os.environ.clear()
        os.environ.update(env_sauvegarde)

    figures = []
    for nom_fichier in sorted(os.listdir(dossier_sortie)):
        if nom_fichier.lower().endswith(".png"):
            import base64
            with open(os.path.join(dossier_sortie, nom_fichier), "rb") as img:
                figures.append(f"data:image/png;base64,{base64.b64encode(img.read()).decode()}")

    return {
        "notes": stdout_capture.getvalue().splitlines(),
        "figures": figures,
        "tableau": None,
        "resume_stats": None,
    }

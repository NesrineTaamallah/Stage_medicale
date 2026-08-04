"""
Utilitaires partagés par toutes les analyses refactorées (SEP + EPR).

Principe du refactor, appliqué de façon identique aux 13 scripts :
  - `print(...)`        -> accumulé dans `notes: list[str]` (mêmes messages
                            pédagogiques qu'en console, affichés dans l'UI)
  - `input(...)`        -> remplacé par un champ du dict `config` reçu en
                            paramètre (donc un champ de formulaire côté React)
  - `plt.show()`        -> remplacé par `figure_to_base64(fig)`, ajouté à
                            `figures: list[str]` (data URLs, affichables
                            directement dans une balise <img>)
  - `df.to_string()`    -> remplacé par `df.to_dict(orient="records")`
                            pour alimenter un tableau React
"""
import base64
import io
import matplotlib
matplotlib.use("Agg")  # pas d'affichage interactif côté serveur
import matplotlib.pyplot as plt


def figure_to_base64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


class Notes:
    """Remplace les print() du script original tout en gardant le même texte."""
    def __init__(self):
        self.lines: list[str] = []

    def add(self, texte: str):
        self.lines.append(texte)

    def __call__(self, texte: str):
        self.add(texte)

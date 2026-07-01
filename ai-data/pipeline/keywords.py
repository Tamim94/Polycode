import json
from pathlib import Path
import yake

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"

# Mots inutiles que l'on souhaite supprimer
STOPWORDS = {
    "bonjour",
    "merci",
    "présentation",
    "bienvenue",
    "attention",
    "formation",
    "suite",
    "vidéo",
    "video",
    "premièrement",
    "deuxièmement",
    "troisièmement"
}


def extract_keywords(video_id):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    transcript = metadata.get("transcript", "")

    extractor = yake.KeywordExtractor(
        lan="fr",
        n=3,               # jusqu'à 3 mots par expression
        dedupLim=0.8,       # supprime les doublons
        dedupFunc="seqm",
        windowsSize=2,
        top=20              # on récupère plus de candidats
    )

    candidates = extractor.extract_keywords(transcript)

    keywords = []

    for keyword, score in candidates:

        keyword = keyword.strip()

        if len(keyword) < 3:
            continue

        if keyword.lower() in STOPWORDS:
            continue

        if any(word in STOPWORDS for word in keyword.lower().split()):
            continue

        if keyword not in keywords:
            keywords.append(keyword)

        if len(keywords) == 8:
            break

    metadata["keywords"] = keywords

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    print("✅ Mots-clés générés.")

    return keywords

import json
from pathlib import Path
import argostranslate.translate

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def translate_video(video_id):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    transcript = metadata["transcript"]

    translated = argostranslate.translate.translate(
        transcript,
        "fr",
        "en"
    )

    metadata["translation"] = translated

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    print("✅ Traduction générée.")

    return translated

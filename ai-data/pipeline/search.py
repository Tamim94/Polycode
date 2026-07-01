import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def search_in_video(video_id, query):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    segments = metadata.get("segments", [])

    results = []

    for seg in segments:

        if query.lower() in seg["text"].lower():

            results.append({
                "time": seg["start"],
                "text": seg["text"]
            })

    return results

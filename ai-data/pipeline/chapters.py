import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def generate_chapters(video_id):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    segments = metadata.get("segments", [])

    # One chapter per Whisper segment — start times are real, not guessed
    chapters = [
        {
            "title": s["text"][:40] + ("..." if len(s["text"]) > 40 else ""),
            "start": s["start"],
        }
        for s in segments
    ]

    metadata["chapters"] = chapters

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    print("✅ Chapitres générés.")

    return chapters

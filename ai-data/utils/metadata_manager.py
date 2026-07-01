import json
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def create_metadata(video_name, language, transcript, segments=None):

    video_id = Path(video_name).stem

    video_folder = OUTPUTS_DIR / video_id
    video_folder.mkdir(parents=True, exist_ok=True)

    metadata_file = video_folder / "metadata.json"

    segments = segments or []
    duration = segments[-1]["end"] if segments else 0

    metadata = {
        "video": video_name,
        "video_id": video_id,
        "language": language,
        "duration": duration,
        "transcript": transcript,
        "segments": segments,
        "summary": "",
        "keywords": [],
        "chapters": [],
        "translation": "",
        "created_at": datetime.now().isoformat()
    }

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    return metadata_file

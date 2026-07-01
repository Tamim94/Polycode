import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def generate_quiz(video_id):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    transcript = metadata["transcript"]

    sentences = [s.strip() for s in transcript.split(".") if s.strip()]

    quiz = []

    for i, sentence in enumerate(sentences[:5]):

        words = sentence.split()

        if len(words) < 6:
            continue

        answer = sentence

        quiz.append({
            "id": i + 1,
            "question": f"Quelle affirmation est présentée dans la partie {i+1} ?",
            "answer": answer,
            "context": sentence
        })

    return quiz

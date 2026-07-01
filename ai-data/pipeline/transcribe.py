import whisper
from pathlib import Path

from utils.metadata_manager import create_metadata

BASE_DIR = Path(__file__).resolve().parent.parent
VIDEOS_DIR = BASE_DIR / "videos"


def transcribe_video(video_name, model_size="small"):

    video_path = VIDEOS_DIR / video_name

    if not video_path.exists():
        raise FileNotFoundError(f"Vidéo introuvable : {video_path}")

    print("Chargement du modèle Whisper...")
    model = whisper.load_model(model_size)

    print("Transcription en cours...")
    result = model.transcribe(
        str(video_path),
        language="fr",
        fp16=False,
        temperature=0
    )

    # Keep Whisper's real per-segment timestamps — chapters/search/quiz need
    # these to point at the actual moment in the video, not a guessed index.
    segments = [
        {
            "start": round(s["start"], 2),
            "end": round(s["end"], 2),
            "text": s["text"].strip(),
        }
        for s in result["segments"]
    ]

    create_metadata(
        video_name=video_name,
        language=result["language"],
        transcript=result["text"],
        segments=segments,
    )

    print("\n✅ metadata.json généré avec succès.")

    return result


if __name__ == "__main__":
    transcribe_video("demo.mp4")

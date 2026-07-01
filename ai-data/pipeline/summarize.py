import json
from pathlib import Path

from sumy.parsers.plaintext import PlaintextParser
from sumy.nlp.tokenizers import Tokenizer
from sumy.summarizers.lsa import LsaSummarizer

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


def summarize_video(video_id):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    transcript = metadata["transcript"]

    parser = PlaintextParser.from_string(transcript, Tokenizer("french"))
    summarizer = LsaSummarizer()

    summary = summarizer(parser.document, 2)

    metadata["summary"] = " ".join(str(sentence) for sentence in summary)

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    print("✅ Résumé généré.")

    return metadata["summary"]

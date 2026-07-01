from fastapi import FastAPI, HTTPException
from pathlib import Path
import json
from fastapi.middleware.cors import CORSMiddleware
from pipeline.analyzer import VideoAnalyzer
from pipeline.search import search_in_video
from pipeline.semantic_search import semantic_search
from pipeline.quiz import generate_quiz
from pipeline.qa import ask_video

app = FastAPI(title="Polycode AI Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4000",
        "http://127.0.0.1:4000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analyzer = VideoAnalyzer()

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(video_name: str):

    try:

        analyzer.analyze(video_name)

        video_id = Path(video_name).stem

        metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        return metadata

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/search")
def search(video_id: str, query: str):

    return search_in_video(video_id, query)

@app.get("/semantic-search")
def semantic(video_id: str, query: str):
    return semantic_search(video_id, query)

@app.get("/quiz")
def quiz(video_id: str):
    return generate_quiz(video_id)


@app.get("/ask")
def ask(video_id: str, question: str):
    return ask_video(video_id, question)

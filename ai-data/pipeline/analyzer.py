from pipeline.transcribe import transcribe_video
from pipeline.keywords import extract_keywords
from pipeline.chapters import generate_chapters
from pipeline.summarize import summarize_video
from pipeline.translate import translate_video
from pathlib import Path

class VideoAnalyzer:

    def __init__(self):
        print("Video Analyzer initialisé.")

    def analyze(self, video_name):

        print(f"Analyse de {video_name}")

        transcribe_video(video_name)
        video_id = Path(video_name).stem

        extract_keywords(video_id)
        summarize_video(video_id)
        generate_chapters(video_id)
        translate_video(video_id)


        print("Analyse terminée.")

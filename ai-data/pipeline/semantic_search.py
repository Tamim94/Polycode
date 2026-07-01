import json
from pathlib import Path
from sentence_transformers import SentenceTransformer, util

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"

# Chargé une seule fois au démarrage
model = SentenceTransformer("all-MiniLM-L6-v2")


def semantic_search(video_id, query):

    metadata_file = OUTPUTS_DIR / video_id / "metadata.json"

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    segments = metadata.get("segments", [])

    if not segments:
        return []

    texts = [s["text"] for s in segments]

    sentence_embeddings = model.encode(texts, convert_to_tensor=True)
    query_embedding = model.encode(query, convert_to_tensor=True)

    scores = util.cos_sim(query_embedding, sentence_embeddings)[0]

    top_k = min(3, len(segments))

    top_results = scores.topk(k=top_k)

    results = []

    for score, idx in zip(top_results.values, top_results.indices):
        seg = segments[int(idx)]
        results.append({
            "time": seg["start"],
            "text": seg["text"],
            "score": round(float(score), 4)
        })

    return results

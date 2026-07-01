from pipeline.semantic_search import semantic_search


def ask_video(video_id, question):

    passages = semantic_search(video_id, question)

    if not passages:
        return {
            "question": question,
            "answer": "Je n'ai trouvé aucune information dans cette vidéo.",
            "sources": []
        }

    useful_sentences = []

    ignored = [
        "merci",
        "bonjour",
        "à bientôt",
        "votre attention"
    ]

    for passage in passages:

        sentence = passage["text"].strip()

        if any(word in sentence.lower() for word in ignored):
            continue

        useful_sentences.append(sentence)

    if not useful_sentences:
        useful_sentences = [p["text"] for p in passages]

    answer = (
        "Selon le contenu de la vidéo, "
        + ". ".join(useful_sentences)
        + "."
    )

    return {
        "question": question,
        "answer": answer,
        "sources": passages
    }

import { AI_SERVER_URL } from "../config";

export async function analyzeVideo(videoName: string) {
  const response = await fetch(
    `${AI_SERVER_URL}/analyze?video_name=${encodeURIComponent(videoName)}`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error("Erreur lors de l'analyse de la vidéo");
  }

  return await response.json();
}

export async function semanticSearch(videoId: string, query: string) {
  const response = await fetch(
    `${AI_SERVER_URL}/semantic-search?video_id=${videoId}&query=${encodeURIComponent(query)}`
  );

  return await response.json();
}

export async function askVideo(videoId: string, question: string) {
  const response = await fetch(
    `${AI_SERVER_URL}/ask?video_id=${videoId}&question=${encodeURIComponent(question)}`
  );

  return await response.json();
}

export async function generateQuiz(videoId: string) {
  const response = await fetch(
    `${AI_SERVER_URL}/quiz?video_id=${videoId}`
  );

  return await response.json();
}

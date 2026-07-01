import { useState } from "react";
import {
  analyzeVideo,
  askVideo,
  generateQuiz,
} from "../../services/aiService";

import styles from "./AIAnalyzer.module.css";

export default function AIAnalyzer() {
  const [result, setResult] = useState<any>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<any>(null);
  const [quiz, setQuiz] = useState<any[]>([]);
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  const stats = result
  ? {
      duration: result.duration
        ? `${Math.floor(result.duration / 60)}:${Math.round(result.duration % 60).toString().padStart(2, "0")}`
        : "—",
      keywords: result.keywords?.length || 0,
      chapters: result.chapters?.length || 0,
      transcriptWords: result.transcript
        ? result.transcript.split(/\s+/).length
        : 0,
    }
  : null;

  async function handleAnalyze() {

  setLoading(true);
  setLoadingText("🎙 Transcribing, summarizing, translating… this can take a minute on first run.");

  try {
    const data = await analyzeVideo("demo.mp4");
    setResult(data);
  } finally {
    setLoading(false);
  }

  }

  async function handleAsk() {

  if (!question.trim()) return;

  setMessages((prev) => [
    ...prev,
    {
      role: "user",
      text: question,
    },
  ]);

  const data = await askVideo("demo", question);

  setMessages((prev) => [
    ...prev,
    {
      role: "assistant",
      text: data.answer,
    },
  ]);

  setAnswer(data);

  setQuestion("");

 }

  async function handleQuiz() {
    const data = await generateQuiz("demo");
    setQuiz(data);
  }

  return (
    <div className={styles.container}>

    <div className={styles.header}>
      <div>
        <h1>🤖 AI Video Analyzer</h1>
        <p>Intelligent AI-powered video analysis</p>
      </div>

      <button
        className={styles.analyzeButton}
        onClick={handleAnalyze}
      >
        🎬 Analyze Video
      </button>
    </div>

    {loading && (

      <div className={styles.loadingCard}>

      <h2>🤖 AI is analysing the video...</h2>

      <div className={styles.loader}></div>

      <p>{loadingText}</p>

      </div>

    )}

    {result && (
      <>
        <div className={styles.statsGrid}>

          <div className={styles.card}>
            <h4>🎥 Duration</h4>
            <span>{stats?.duration}</span>
          </div>

          <div className={styles.card}>
            <h4>📝 Words</h4>
            <span>{stats?.transcriptWords}</span>
          </div>

          <div className={styles.card}>
            <h4>🏷 Keywords</h4>
            <span>{stats?.keywords}</span>
          </div>

          <div className={styles.card}>
            <h4>📚 Chapters</h4>
            <span>{stats?.chapters}</span>
          </div>

        </div>

        <h3>📝 Summary</h3>
        <p>{result.summary}</p>

        <h3>🎙 Transcript</h3>
        <p>{result.transcript}</p>

        <h3>🌍 Translation</h3>
        <p>{result.translation}</p>

        <h3>🏷 Keywords</h3>

        <div className={styles.keywordContainer}>
          {result.keywords.map((k: string) => (
            <span
              key={k}
              className={styles.keyword}
            >
              {k}
            </span>
          ))}
        </div>

        <h3>📚 Chapters</h3>

        <ul>
          {result.chapters.map((c: any) => (
            <li key={c.start}>
              ▶ {c.start}s — {c.title}
            </li>
          ))}
        </ul>
      </>
    )}

    <hr />

    <h3>🔍 Search the Video</h3>

    <input
      value={question}
      onChange={(e) => setQuestion(e.target.value)}
      placeholder="Search for a topic or keyword..."
    />

    <button onClick={handleAsk}>
      Search
    </button>

      <div className={styles.chatBox}>

    {messages.map((m, index) => (

      <div
        key={index}
        className={
          m.role === "user"
            ? styles.userMessage
            : styles.aiMessage
        }
      >

        <strong>

          {m.role === "user"
            ? "👤 You"
            : "🤖 AI"}

        </strong>

        <p>{m.text}</p>

      </div>

   ))}

  </div>

    <hr />

    <button
      className={styles.analyzeButton}
      onClick={handleQuiz}
    >
      📖 Generate Quiz
    </button>

    {quiz.length > 0 && (
  <>
    <h3>📖 AI Quiz</h3>

    {quiz.map((q) => (
      <div key={q.id} className={styles.quizCard}>

        <h4>{q.question}</h4>

        <button
          className={styles.answerButton}
          onClick={() => alert(q.answer)}
        >
          ✅ Show Answer
        </button>

      </div>
    ))}
  </>
)}

  </div>
);
}

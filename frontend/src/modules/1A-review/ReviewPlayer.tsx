import { useCallback, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Comment, ToolType } from './types'
import { useCanvas } from './useCanvas'
import { useWebSocket } from './useWebSocket'
import styles from './ReviewPlayer.module.css'

// Stable client ID for this browser tab — not persisted, intentionally ephemeral
const CLIENT_ID = uuidv4()

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export default function ReviewPlayer() {
  const [sessionId, setSessionId] = useState(() => uuidv4().slice(0, 8))
  const [pendingId, setPendingId] = useState(sessionId)
  const [videoUrl, setVideoUrl] = useState('/sample.mp4')
  const [tool, setTool] = useState<ToolType>('pen')
  const [color, setColor] = useState('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [drawMode, setDrawMode] = useState(false)
  const [commentText, setCommentText] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const { connected, state, setState, sendStroke, sendComment, sendClear } = useWebSocket(sessionId)

  const handleStrokeComplete = useCallback(
    (stroke: Parameters<typeof sendStroke>[0]) => {
      setState(prev => ({ ...prev, strokes: [...prev.strokes, stroke] }))
      sendStroke(stroke)
    },
    [sendStroke, setState],
  )

  const { canvasRef, ...canvasHandlers } = useCanvas({
    clientId: CLIENT_ID,
    tool,
    color,
    width: strokeWidth,
    strokes: state.strokes,
    onStrokeComplete: handleStrokeComplete,
  })

  function joinSession() {
    const id = pendingId.trim() || uuidv4().slice(0, 8)
    setPendingId(id)
    setSessionId(id)
  }

  function postComment() {
    if (!commentText.trim()) return
    const comment: Comment = {
      id: uuidv4(),
      clientId: CLIENT_ID,
      text: commentText.trim(),
      videoTime: videoRef.current?.currentTime ?? 0,
      timestamp: Date.now(),
    }
    setState(prev => ({ ...prev, comments: [...prev.comments, comment] }))
    sendComment(comment)
    setCommentText('')
  }

  function seekTo(time: number) {
    if (videoRef.current) videoRef.current.currentTime = time
  }

  function handleClear() {
    setState(prev => ({ ...prev, strokes: [] }))
    sendClear()
  }

  function exportJson() {
    const payload = JSON.stringify(
      { sessionId, exportedAt: new Date().toISOString(), ...state },
      null, 2,
    )
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([payload], { type: 'application/json' })),
      download: `session-${sessionId}.json`,
    })
    a.click()
  }

  function copySessionId() {
    navigator.clipboard.writeText(sessionId).catch(() => {})
  }

  const sortedComments = [...state.comments].sort((a, b) => a.videoTime - b.videoTime)

  return (
    <div className={styles.root}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>

        <div className={styles.group}>
          <span className={connected ? styles.dotGreen : styles.dotRed} title={connected ? 'Connected' : 'Disconnected'} />
          <label className={styles.label}>Session</label>
          <input
            className={styles.sessionInput}
            value={pendingId}
            onChange={e => setPendingId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && joinSession()}
            placeholder="session ID"
          />
          <button className={styles.btn} onClick={joinSession}>Join</button>
          <button className={styles.btnGhost} onClick={copySessionId} title="Copy session ID to share">Copy ID</button>
        </div>

        <div className={styles.group}>
          <label className={styles.label}>Tool</label>
          {(['pen', 'arrow', 'rect'] as ToolType[]).map(t => (
            <button
              key={t}
              className={`${styles.toolBtn} ${tool === t ? styles.toolActive : ''}`}
              onClick={() => setTool(t)}
            >
              {t === 'pen' ? 'Pen' : t === 'arrow' ? 'Arrow' : 'Rect'}
            </button>
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className={styles.colorPicker} title="Stroke color" />
          <input type="range" min={1} max={12} value={strokeWidth} onChange={e => setStrokeWidth(+e.target.value)} className={styles.slider} title={`Width: ${strokeWidth}px`} />
        </div>

        <div className={styles.group}>
          <button
            className={`${styles.btn} ${drawMode ? styles.btnActive : ''}`}
            onClick={() => setDrawMode(d => !d)}
          >
            {drawMode ? 'Drawing ON' : 'Drawing OFF'}
          </button>
          <button className={styles.btnDanger} onClick={handleClear}>Clear</button>
          <button className={styles.btn} onClick={exportJson}>Export JSON</button>
        </div>

      </div>

      {/* ── Video URL bar ─────────────────────────────────────────────────── */}
      <div className={styles.urlBar}>
        <label className={styles.label}>Video</label>
        <input
          className={styles.urlInput}
          value={videoUrl}
          onChange={e => setVideoUrl(e.target.value)}
          placeholder="URL or /sample.mp4"
        />
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className={styles.content}>

        {/* Video + canvas */}
        <div className={styles.videoArea}>
          <div className={styles.videoWrap}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className={styles.video}
              crossOrigin="anonymous"
            />
            <canvas
              ref={canvasRef}
              width={1280}
              height={720}
              className={styles.canvas}
              style={{ pointerEvents: drawMode ? 'all' : 'none' }}
              {...canvasHandlers}
            />
            {drawMode && (
              <div className={styles.drawBadge}>Drawing mode — click drag to annotate</div>
            )}
          </div>
        </div>

        {/* Comment panel */}
        <aside className={styles.panel}>
          <h3 className={styles.panelTitle}>Comments ({state.comments.length})</h3>

          <div className={styles.commentList}>
            {sortedComments.length === 0 && (
              <p className={styles.empty}>No comments yet. Post one below.</p>
            )}
            {sortedComments.map(c => (
              <button key={c.id} className={styles.commentItem} onClick={() => seekTo(c.videoTime)}>
                <span className={styles.timestamp}>{formatTime(c.videoTime)}</span>
                <span className={styles.commentText}>{c.text}</span>
              </button>
            ))}
          </div>

          <div className={styles.commentForm}>
            <input
              className={styles.commentInput}
              placeholder="Comment at current timestamp…"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && postComment()}
            />
            <button className={styles.btn} onClick={postComment}>Post</button>
          </div>
        </aside>

      </div>
    </div>
  )
}

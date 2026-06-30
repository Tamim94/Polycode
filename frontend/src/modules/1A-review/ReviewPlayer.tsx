import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { KEY_SERVER_URL, VIDEO_SERVER_URL } from '../../config'
import type { Comment, ToolType } from './types'
import { useCanvas } from './useCanvas'
import { useWebSocket } from './useWebSocket'
import styles from './ReviewPlayer.module.css'

// Stable identity for this browser tab — intentionally ephemeral
const CLIENT_ID = uuidv4()

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export default function ReviewPlayer() {
  // Seed session ID from ?session= URL param so sharing a link auto-joins the session
  const [sessionId, setSessionId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('session') || uuidv4().slice(0, 8)
  })
  const [pendingId, setPendingId]     = useState(sessionId)
  const [videoUrl, setVideoUrl]       = useState('/sample.mp4')
  const [streamMode, setStreamMode]   = useState<'plain' | 'secured'>('plain')
  const [securingStream, setSecuringStream] = useState(false)
  const [tool, setTool]               = useState<ToolType>('pen')
  const [color, setColor]             = useState('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [drawMode, setDrawMode]       = useState(false)
  const [commentText, setCommentText] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef   = useRef<Hls | null>(null)

  const { connected, state, setState, sendStroke, sendComment, sendClear } = useWebSocket(sessionId)

  // Tear down hls.js when the component unmounts
  useEffect(() => () => { hlsRef.current?.destroy() }, [])

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

  // ── Session management ─────────────────────────────────────────────────

  function joinSession() {
    const id = pendingId.trim() || uuidv4().slice(0, 8)
    setPendingId(id)
    setSessionId(id)
    // Push the session ID into the URL so sharing the tab URL auto-joins
    window.history.pushState({}, '', `?session=${id}`)
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?session=${sessionId}`
    navigator.clipboard.writeText(url)
      .then(() => { setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000) })
      .catch(() => {})
  }

  // ── Video / stream management ──────────────────────────────────────────

  function handleVideoUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setVideoUrl(e.target.value)
    // Switching to a plain URL: destroy hls.js if it was active
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
      setStreamMode('plain')
    }
  }

  function exitSecuredMode() {
    hlsRef.current?.destroy()
    hlsRef.current = null
    setStreamMode('plain')
  }

  // Connects 1A directly to the 2A pipeline:
  // auto-fetches a token from the key-server, then loads the AES-128
  // encrypted HLS stream so annotations sit on top of a secured video.
  async function loadSecuredStream() {
    if (!videoRef.current) return
    setSecuringStream(true)
    try {
      const res = await fetch(`${KEY_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'polycode2024' }),
      })
      if (!res.ok) throw new Error('Token request failed')
      const { access_token } = await res.json()

      hlsRef.current?.destroy()
      const hls = new Hls({
        xhrSetup: (xhr, url) => {
          if (url.includes('/key')) {
            xhr.setRequestHeader('Authorization', `Bearer ${access_token}`)
          }
        },
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {})
      })
      hls.loadSource(`${VIDEO_SERVER_URL}/hls/stream.m3u8`)
      hls.attachMedia(videoRef.current)
      hlsRef.current = hls
      setStreamMode('secured')
    } catch (err) {
      console.error('Secured stream error:', err)
    } finally {
      setSecuringStream(false)
    }
  }

  // ── Comments / canvas ──────────────────────────────────────────────────

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
          <button className={styles.btnGhost} onClick={copyLink}>
            {copyFeedback ? 'Copied!' : 'Copy Link'}
          </button>
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

      {/* ── Video source bar ──────────────────────────────────────────────── */}
      <div className={styles.urlBar}>
        <label className={styles.label}>Video</label>
        {streamMode === 'secured' ? (
          <>
            <span className={styles.secureBadge}>Secured stream active — AES-128 / Zero-Trust (2A)</span>
            <button className={styles.btnGhost} onClick={exitSecuredMode}>Switch to plain</button>
          </>
        ) : (
          <>
            <input
              className={styles.urlInput}
              value={videoUrl}
              onChange={handleVideoUrlChange}
              placeholder="Video URL or /sample.mp4"
            />
            <button
              className={styles.btnSecure}
              onClick={loadSecuredStream}
              disabled={securingStream}
              title="Fetch a JWT from the key-server and load the AES-128 encrypted stream from the 2A pipeline"
            >
              {securingStream ? 'Connecting…' : 'Load Secured Stream (2A)'}
            </button>
          </>
        )}
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className={styles.content}>

        <div className={styles.videoArea}>
          <div className={styles.videoWrap}>
            {/* When hls.js is active (secured mode) the src must be absent —
                hls.js owns the media element directly */}
            <video
              ref={videoRef}
              src={streamMode === 'plain' ? videoUrl : undefined}
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
              <div className={styles.drawBadge}>Drawing mode — click & drag to annotate</div>
            )}
          </div>
        </div>

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

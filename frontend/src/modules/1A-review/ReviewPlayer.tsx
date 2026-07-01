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

function clientColor(clientId: string): string {
  let hash = 0
  for (const c of clientId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffff
  return `hsl(${hash % 360}, 80%, 55%)`
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export default function ReviewPlayer() {
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
  const [syncMode, setSyncMode]         = useState(false)
  const [temporalMode, setTemporalMode] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { x: number; y: number; t: number }>>({})

  const videoRef         = useRef<HTMLVideoElement>(null)
  const hlsRef           = useRef<Hls | null>(null)
  const lastCursorSendRef = useRef(0)
  // Timestamp of last sync received from a peer — blocks re-broadcasting for 500ms
  const lastSyncReceivedRef = useRef(0)
  const isSyncing = () => Date.now() - lastSyncReceivedRef.current < 500

  const handleRemoteCursor = useCallback((clientId: string, x: number, y: number) => {
    setRemoteCursors(prev => ({ ...prev, [clientId]: { x, y, t: Date.now() } }))
  }, [])

  const handleRemoteSeek = useCallback((time: number) => {
    if (!syncMode || !videoRef.current) return
    lastSyncReceivedRef.current = Date.now()
    videoRef.current.currentTime = time
  }, [syncMode])

  const handleRemotePlay = useCallback((time: number) => {
    if (!syncMode || !videoRef.current) return
    lastSyncReceivedRef.current = Date.now()
    videoRef.current.currentTime = time
    videoRef.current.play().catch(() => {})
  }, [syncMode])

  const handleRemotePause = useCallback((time: number) => {
    if (!syncMode || !videoRef.current) return
    lastSyncReceivedRef.current = Date.now()
    videoRef.current.currentTime = time
    videoRef.current.pause()
  }, [syncMode])

  const { connected, state, setState, sendStroke, sendComment, sendClear, sendRemoveStroke, sendCursor, sendSeek, sendPlay, sendPause } =
    useWebSocket(sessionId, { onSeek: handleRemoteSeek, onPlay: handleRemotePlay, onPause: handleRemotePause, onCursor: handleRemoteCursor })

  // Local undo stack — only tracks strokes drawn by this client
  const [undoStack, setUndoStack] = useState<Parameters<typeof sendStroke>[0][]>([])

  useEffect(() => () => { hlsRef.current?.destroy() }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // Remove cursors that haven't moved in 3s
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setRemoteCursors(prev => {
        const next = { ...prev }
        let changed = false
        for (const cid in next) {
          if (now - next[cid].t > 3000) { delete next[cid]; changed = true }
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const handleStrokeComplete = useCallback(
    (stroke: Parameters<typeof sendStroke>[0]) => {
      setUndoStack([])
      const stamped = temporalMode && videoRef.current
        ? { ...stroke, videoTime: videoRef.current.currentTime }
        : stroke
      setState(prev => ({ ...prev, strokes: [...prev.strokes, stamped] }))
      sendStroke(stamped)
    },
    [sendStroke, setState, temporalMode],
  )

  const handleUndo = useCallback(() => {
    setState(prev => {
      const myStrokes = prev.strokes.filter(s => s.clientId === CLIENT_ID)
      if (myStrokes.length === 0) return prev
      const target = myStrokes[myStrokes.length - 1]
      setUndoStack(stack => [...stack, target])
      sendRemoveStroke(target.id)
      return { ...prev, strokes: prev.strokes.filter(s => s.id !== target.id) }
    })
  }, [sendRemoveStroke])

  const handleRedo = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack
      const stroke = stack[stack.length - 1]
      setState(prev => ({ ...prev, strokes: [...prev.strokes, stroke] }))
      sendStroke(stroke)
      return stack.slice(0, -1)
    })
  }, [sendStroke, setState])

  // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, handleRedo])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function onTimeUpdate() {
      setVideoCurrentTime(video!.currentTime)
    }

    function onPlay() {
      if (!syncMode || isSyncing()) return
      sendPlay(video!.currentTime)
    }

    function onPause() {
      if (!syncMode || isSyncing()) return
      sendPause(video!.currentTime)
    }

    function onSeeked() {
      if (!syncMode || isSyncing()) return
      sendSeek(video!.currentTime)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [syncMode, sendPlay, sendPause, sendSeek])

  const { canvasRef, ...canvasHandlers } = useCanvas({
    clientId: CLIENT_ID,
    tool,
    color,
    width: strokeWidth,
    strokes: state.strokes,
    currentTime: videoCurrentTime,
    onStrokeComplete: handleStrokeComplete,
  })

  function joinSession() {
    const id = pendingId.trim() || uuidv4().slice(0, 8)
    setPendingId(id)
    setSessionId(id)
    window.history.pushState({}, '', `?session=${id}`)
  }

  function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?session=${sessionId}`
    navigator.clipboard.writeText(url)
      .then(() => { setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000) })
      .catch(() => {})
  }

  function handleVideoUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setVideoUrl(e.target.value)
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
    setUndoStack([])
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
          <button
            className={styles.btnGhost}
            onClick={handleUndo}
            disabled={state.strokes.filter(s => s.clientId === CLIENT_ID).length === 0}
            title="Undo last stroke (Ctrl+Z)"
          >
            ↩ Undo
          </button>
          <button
            className={styles.btnGhost}
            onClick={handleRedo}
            disabled={undoStack.length === 0}
            title="Redo (Ctrl+Y)"
          >
            ↪ Redo
          </button>
          <button className={styles.btnDanger} onClick={handleClear}>Clear</button>
          <button className={styles.btn} onClick={exportJson}>Export JSON</button>
        </div>

        <div className={styles.group}>
          <label className={styles.label}>Vitesse</label>
          {[0.25, 0.5, 1, 1.5, 2].map(r => (
            <button
              key={r}
              className={`${styles.toolBtn} ${playbackRate === r ? styles.toolActive : ''}`}
              onClick={() => setPlaybackRate(r)}
            >
              {r === 1 ? '1×' : `${r}×`}
            </button>
          ))}
        </div>

        <div className={styles.group}>
          <button
            className={`${styles.btnSync} ${syncMode ? styles.btnSyncActive : ''}`}
            onClick={() => setSyncMode(m => !m)}
            title="Synchronise play/pause/seek with all clients in the session"
          >
            {syncMode ? '⟳ Sync ON' : '⟳ Sync OFF'}
          </button>
          <button
            className={`${styles.btnTemporal} ${temporalMode ? styles.btnTemporalActive : ''}`}
            onClick={() => setTemporalMode(m => !m)}
            title="Link new annotations to the current video timestamp"
          >
            {temporalMode ? '⏱ Temporal ON' : '⏱ Temporal OFF'}
          </button>
        </div>

      </div>

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

      <div className={styles.content}>

        <div className={styles.videoArea}>
          <div
            className={styles.videoWrap}
            onMouseMove={e => {
              const now = Date.now()
              if (now - lastCursorSendRef.current < 40) return
              lastCursorSendRef.current = now
              const rect = e.currentTarget.getBoundingClientRect()
              sendCursor(CLIENT_ID, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
            }}
            onMouseLeave={() => setRemoteCursors(prev => { const n = { ...prev }; delete n[CLIENT_ID]; return n })}
          >
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
            {Object.entries(remoteCursors).map(([cid, pos]) => (
              <div
                key={cid}
                className={styles.remoteCursor}
                style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, background: clientColor(cid) }}
              >
                <div className={styles.remoteCursorDot} />
                <span className={styles.remoteCursorLabel}>{cid.slice(0, 4)}</span>
              </div>
            ))}
            {drawMode && (
              <div className={styles.drawBadge}>
                {temporalMode
                  ? `Temporal mode — annotations linked to ${formatTime(videoCurrentTime)}`
                  : 'Drawing mode — click & drag to annotate'}
              </div>
            )}
            {syncMode && (
              <div className={styles.syncBadge}>Sync actif</div>
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

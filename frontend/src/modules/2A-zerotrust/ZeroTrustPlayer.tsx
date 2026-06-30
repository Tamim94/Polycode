import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KEY_SERVER_URL, VIDEO_SERVER_URL } from '../../config'
import styles from './ZeroTrustPlayer.module.css'

interface LogEntry {
  time: string
  text: string
  ok?: boolean  // true = success, false = error, undefined = neutral
}

type Phase = 'idle' | 'fetching-token' | 'token-ready' | 'loading-stream' | 'playing' | 'error'

const STEP_ORDER: Phase[] = ['idle', 'token-ready', 'loading-stream', 'playing']

function phaseIndex(p: Phase) { return STEP_ORDER.indexOf(p) }
function isAfter(current: Phase, target: Phase) { return phaseIndex(current) > phaseIndex(target) }
function isAt(current: Phase, targets: Phase[]) { return targets.includes(current) }

function fmtTtl(s: number) {
  return s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}` : 'EXPIRED'
}

export default function ZeroTrustPlayer() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [username, setUsername] = useState('demo')
  const [password, setPassword] = useState('polycode2024')
  const [token, setToken] = useState<string | null>(null)
  const [ttl, setTtl] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  // Stable ref so xhrSetup always reads the current token without a closure dependency
  const tokenRef = useRef<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((text: string, ok?: boolean) => {
    setLog(prev => [...prev, { time: new Date().toLocaleTimeString(), text, ok }])
  }, [])

  // Auto-scroll security log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log])

  // Token expiry countdown — computed from a captured absolute timestamp
  useEffect(() => {
    if (!token || ttl <= 0) return
    const expiresAt = Date.now() + ttl * 1000
    const iv = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setTtl(remaining)
      if (remaining === 0) {
        clearInterval(iv)
        addLog('Token expired — next key request will be refused with 403 Forbidden.', false)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [token]) // intentionally only on token change, not ttl

  // Destroy hls.js on unmount
  useEffect(() => () => { hlsRef.current?.destroy() }, [])

  async function fetchToken() {
    setPhase('fetching-token')
    addLog(`POST ${KEY_SERVER_URL}/token — requesting JWT…`)
    try {
      const res = await fetch(`${KEY_SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`${res.status} — ${body.detail ?? res.statusText}`)
      }
      const data = await res.json()
      tokenRef.current = data.access_token
      setToken(data.access_token)
      setTtl(data.expires_in)
      setPhase('token-ready')
      addLog(`✓ JWT issued (alg: HS256, exp: ${data.expires_in}s) — ${data.access_token.slice(0, 20)}…`, true)
    } catch (err) {
      addLog(`✗ Token request failed: ${err}`, false)
      setPhase('idle')
    }
  }

  function loadStream() {
    if (!videoRef.current) return
    hlsRef.current?.destroy()

    if (!Hls.isSupported()) {
      addLog('✗ hls.js is not supported in this browser. Use Chrome or Firefox.', false)
      setPhase('error')
      return
    }

    setPhase('loading-stream')
    addLog(`GET ${VIDEO_SERVER_URL}/hls/stream.m3u8 — fetching encrypted playlist…`)

    const hls = new Hls({
      // Inject Bearer token on every request that targets the /key endpoint
      xhrSetup: (xhr, url) => {
        if (url.includes('/key')) {
          xhr.setRequestHeader('Authorization', `Bearer ${tokenRef.current ?? ''}`)
        }
      },
    })
    hlsRef.current = hls

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      addLog('✓ Playlist parsed — stream is AES-128 encrypted (EXT-X-KEY present in manifest)', true)
    })

    hls.on(Hls.Events.KEY_LOADING, () => {
      addLog(`GET ${KEY_SERVER_URL}/key — presenting Bearer token to key-server…`)
    })

    hls.on(Hls.Events.KEY_LOADED, () => {
      addLog('✓ 200 OK — key-server accepted token, returned 16-byte AES-128 key', true)
      setPhase('playing')
      videoRef.current?.play().catch(() => {})
    })

    hls.on(Hls.Events.ERROR, (_, data) => {
      const is403 = data.response?.code === 403
      const isKeyError = data.details === Hls.ErrorDetails.KEY_LOAD_ERROR
      if (is403 || isKeyError) {
        addLog('✗ 403 Forbidden — key-server rejected the request (token invalid or expired)', false)
        setPhase('error')
      } else if (data.fatal) {
        addLog(`✗ Fatal stream error: ${data.details}`, false)
        setPhase('error')
      }
    })

    hls.loadSource(`${VIDEO_SERVER_URL}/hls/stream.m3u8`)
    hls.attachMedia(videoRef.current)
  }

  const ttlColor = ttl > 60 ? '#22c55e' : ttl > 0 ? '#f59e0b' : '#ef4444'
  const tokenPreview = token ? `${token.slice(0, 28)}…` : null
  const busy = isAt(phase, ['fetching-token', 'loading-stream'])

  return (
    <div className={styles.root}>

      {/* ── Zero-trust flow steps ─────────────────────────────────────────── */}
      <div className={styles.flowBar}>
        {[
          { label: 'Authenticate', phases: ['idle', 'fetching-token'] as Phase[] },
          { label: 'Token issued', phases: ['token-ready'] as Phase[] },
          { label: 'Key validated', phases: ['loading-stream'] as Phase[] },
          { label: 'Playing', phases: ['playing'] as Phase[] },
        ].map(({ label, phases }, i) => {
          const active = isAt(phase, phases)
          const done = isAfter(phase, phases[phases.length - 1])
          return (
            <div key={i} className={`${styles.step} ${active ? styles.stepActive : ''} ${done ? styles.stepDone : ''}`}>
              <span className={styles.stepNum}>{done ? '✓' : i + 1}</span>
              <span>{label}</span>
            </div>
          )
        })}
      </div>

      <div className={styles.content}>

        {/* ── Video ─────────────────────────────────────────────────────── */}
        <div className={styles.videoWrap}>
          <video ref={videoRef} controls className={styles.video} />
          {phase !== 'playing' && (
            <div className={styles.videoOverlay}>
              {isAt(phase, ['idle', 'fetching-token']) && 'Step 1: authenticate to unlock playback'}
              {phase === 'token-ready' && 'Token ready — click "Load Stream" to begin'}
              {phase === 'loading-stream' && 'Requesting AES-128 key from key-server…'}
              {phase === 'error' && 'Playback blocked — see security log'}
            </div>
          )}
        </div>

        {/* ── Control panel ─────────────────────────────────────────────── */}
        <aside className={styles.panel}>

          {/* Auth */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Step 1 — Authenticate</h3>
            <p className={styles.hint}>
              Fixed demo credentials — stand-in for real auth (see <code>key-server/main.py</code>).
            </p>
            <div className={styles.fields}>
              <div className={styles.field}>
                <label>Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} disabled={busy} />
              </div>
              <div className={styles.field}>
                <label>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
              </div>
            </div>
            <button className={styles.btn} onClick={fetchToken} disabled={busy}>
              {phase === 'fetching-token' ? 'Requesting…' : 'Get Token  →  POST /token'}
            </button>
          </section>

          {/* Token status */}
          {token && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Step 2 — Token</h3>
              <div className={styles.tokenBox}>
                <code className={styles.tokenPreview}>{tokenPreview}</code>
                <div className={styles.tokenMeta}>
                  <span>alg: HS256 · sub: {username}</span>
                  <span style={{ color: ttlColor }}>
                    Expires: {fmtTtl(ttl)}
                  </span>
                </div>
              </div>
              <button
                className={styles.btn}
                onClick={loadStream}
                disabled={phase === 'loading-stream' || phase === 'playing'}
              >
                Load Encrypted Stream  →  GET /hls/stream.m3u8
              </button>
              {phase === 'error' && (
                <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchToken}>
                  Refresh Token
                </button>
              )}
            </section>
          )}

          {/* Security log */}
          <section className={`${styles.section} ${styles.logSection}`}>
            <h3 className={styles.sectionTitle}>Security log</h3>
            <div className={styles.log}>
              {log.length === 0 && (
                <span className={styles.empty}>Events will appear here as each step executes.</span>
              )}
              {log.map((e, i) => (
                <div
                  key={i}
                  className={`${styles.logEntry} ${e.ok === true ? styles.logOk : e.ok === false ? styles.logErr : ''}`}
                >
                  <span className={styles.logTime}>{e.time}</span>
                  <span>{e.text}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>

        </aside>
      </div>
    </div>
  )
}

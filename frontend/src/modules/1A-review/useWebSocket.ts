import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_URL } from '../../config'
import type { Comment, SessionState, Stroke } from './types'

export function useWebSocket(sessionId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<SessionState>({ strokes: [], comments: [] })

  useEffect(() => {
    let destroyed = false
    let ws: WebSocket

    function connect() {
      ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (destroyed) return
        setConnected(true)
        ws.send(JSON.stringify({ type: 'join', sessionId }))
      }

      ws.onmessage = (ev) => {
        if (destroyed) return
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }

        if (msg.type === 'sync') {
          setState({ strokes: msg.strokes, comments: msg.comments })
        } else if (msg.type === 'stroke') {
          setState(prev => ({ ...prev, strokes: [...prev.strokes, msg.data] }))
        } else if (msg.type === 'comment') {
          setState(prev => ({ ...prev, comments: [...prev.comments, msg.data] }))
        } else if (msg.type === 'clear') {
          setState(prev => ({ ...prev, strokes: [] }))
        }
      }

      ws.onclose = () => {
        if (destroyed) return
        setConnected(false)
        // Auto-reconnect — the server will resync state on rejoin
        setTimeout(() => { if (!destroyed) connect() }, 2000)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      destroyed = true
      ws?.close()
    }
  }, [sessionId])

  const sendStroke = useCallback((stroke: Stroke) => {
    wsRef.current?.send(JSON.stringify({ type: 'stroke', sessionId, data: stroke }))
  }, [sessionId])

  const sendComment = useCallback((comment: Comment) => {
    wsRef.current?.send(JSON.stringify({ type: 'comment', sessionId, data: comment }))
  }, [sessionId])

  const sendClear = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'clear', sessionId }))
  }, [sessionId])

  return { connected, state, setState, sendStroke, sendComment, sendClear }
}

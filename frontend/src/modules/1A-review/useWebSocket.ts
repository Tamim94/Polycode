import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_URL } from '../../config'
import type { Comment, SessionState, Stroke } from './types'

interface VideoSyncHandlers {
  onSeek:   (time: number) => void
  onPlay:   (time: number) => void
  onPause:  (time: number) => void
  onCursor?: (clientId: string, x: number, y: number) => void
}

export function useWebSocket(sessionId: string, videoSync?: VideoSyncHandlers) {
  const wsRef    = useRef<WebSocket | null>(null)
  const syncRef  = useRef(videoSync)
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<SessionState>({ strokes: [], comments: [] })

  // Always keep syncRef pointing at the latest callbacks without re-connecting
  useEffect(() => { syncRef.current = videoSync })

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
        } else if (msg.type === 'removeStroke') {
          setState(prev => ({ ...prev, strokes: prev.strokes.filter(s => s.id !== msg.strokeId) }))
        } else if (msg.type === 'seek') {
          syncRef.current?.onSeek(msg.time)
        } else if (msg.type === 'play') {
          syncRef.current?.onPlay(msg.time)
        } else if (msg.type === 'pause') {
          syncRef.current?.onPause(msg.time)
        } else if (msg.type === 'cursor') {
          syncRef.current?.onCursor?.(msg.clientId, msg.x, msg.y)
        }
      }

      ws.onclose = () => {
        if (destroyed) return
        setConnected(false)
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

  const sendRemoveStroke = useCallback((strokeId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'removeStroke', sessionId, strokeId }))
  }, [sessionId])

  const sendCursor = useCallback((clientId: string, x: number, y: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'cursor', sessionId, clientId, x, y }))
  }, [sessionId])

  const sendSeek = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'seek', sessionId, time }))
  }, [sessionId])

  const sendPlay = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'play', sessionId, time }))
  }, [sessionId])

  const sendPause = useCallback((time: number) => {
    wsRef.current?.send(JSON.stringify({ type: 'pause', sessionId, time }))
  }, [sessionId])

  return { connected, state, setState, sendStroke, sendComment, sendClear, sendRemoveStroke, sendCursor, sendSeek, sendPlay, sendPause }
}

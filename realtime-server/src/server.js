'use strict'

const { WebSocketServer } = require('ws')
const { v4: uuidv4 } = require('uuid')

const PORT = 8080

// sessionId → { strokes: Stroke[], comments: Comment[], clients: Set<WebSocket> }
const sessions = new Map()

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { strokes: [], comments: [], clients: new Set() })
  }
  return sessions.get(sessionId)
}

function broadcast(session, msg, excludeClient = null) {
  const payload = JSON.stringify(msg)
  for (const client of session.clients) {
    if (client !== excludeClient && client.readyState === 1 /* OPEN */) {
      client.send(payload)
    }
  }
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

wss.on('connection', (ws) => {
  let currentSessionId = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    const { type, sessionId } = msg

    if (type === 'join') {
      currentSessionId = sessionId || uuidv4()
      const session = getOrCreateSession(currentSessionId)
      session.clients.add(ws)
      // Send full current state to the joining/reconnecting client
      ws.send(JSON.stringify({
        type: 'sync',
        sessionId: currentSessionId,
        strokes: session.strokes,
        comments: session.comments,
      }))
      return
    }

    if (!currentSessionId) return
    const session = sessions.get(currentSessionId)
    if (!session) return

    if (type === 'stroke') {
      session.strokes.push(msg.data)
      broadcast(session, { type: 'stroke', data: msg.data }, ws)
    } else if (type === 'comment') {
      session.comments.push(msg.data)
      broadcast(session, { type: 'comment', data: msg.data }, ws)
    } else if (type === 'clear') {
      session.strokes = []
      broadcast(session, { type: 'clear' }, ws)
    } else if (type === 'removeStroke') {
      session.strokes = session.strokes.filter(s => s.id !== msg.strokeId)
      broadcast(session, { type: 'removeStroke', strokeId: msg.strokeId }, ws)
    }
  })

  ws.on('close', () => {
    if (currentSessionId) {
      const session = sessions.get(currentSessionId)
      if (session) session.clients.delete(ws)
    }
  })
})

console.log(`Realtime server running on ws://0.0.0.0:${PORT}`)

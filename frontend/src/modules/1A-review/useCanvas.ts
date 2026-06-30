import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ArrowStroke, PenStroke, Point, RectStroke, Stroke, ToolType } from './types'

interface Options {
  clientId: string
  tool: ToolType
  color: string
  width: number
  strokes: Stroke[]
  onStrokeComplete: (stroke: Stroke) => void
}

export function useCanvas({ clientId, tool, color, width, strokes, onStrokeComplete }: Options) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const currentStrokeRef = useRef<Stroke | null>(null)
  // Keep a ref in sync with the prop so render() needs no dependencies
  const strokesRef = useRef<Stroke[]>(strokes)

  useEffect(() => {
    strokesRef.current = strokes
    render()
  })

  function render() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const s of strokesRef.current) drawStroke(ctx, s)
    if (currentStrokeRef.current) drawStroke(ctx, currentStrokeRef.current)
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getPos(e)
    const id = uuidv4()
    if (tool === 'pen') {
      currentStrokeRef.current = { id, clientId, tool: 'pen', color, width, points: [pos] }
    } else if (tool === 'arrow') {
      currentStrokeRef.current = { id, clientId, tool: 'arrow', color, width, from: pos, to: pos }
    } else {
      currentStrokeRef.current = { id, clientId, tool: 'rect', color, width, x: pos.x, y: pos.y, w: 0, h: 0 }
    }
    drawingRef.current = true
  }, [clientId, tool, color, width])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) return
    const pos = getPos(e)
    const s = currentStrokeRef.current
    if (s.tool === 'pen') {
      (s as PenStroke).points.push(pos)
    } else if (s.tool === 'arrow') {
      (s as ArrowStroke).to = pos
    } else {
      const r = s as RectStroke
      r.w = pos.x - r.x
      r.h = pos.y - r.y
    }
    render()
  }, [])

  const onMouseUp = useCallback(() => {
    if (!drawingRef.current || !currentStrokeRef.current) return
    drawingRef.current = false
    const stroke = { ...currentStrokeRef.current }
    // Deep-copy points array so the ref can be cleared safely
    if (stroke.tool === 'pen') {
      stroke.points = [...(stroke as PenStroke).points]
    }
    currentStrokeRef.current = null
    render()
    onStrokeComplete(stroke)
  }, [onStrokeComplete])

  return { canvasRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp }
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.tool === 'pen') {
    if (s.points.length < 2) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
  } else if (s.tool === 'arrow') {
    drawArrow(ctx, s.from, s.to)
  } else {
    ctx.strokeRect(s.x, s.y, s.w, s.h)
  }

  ctx.restore()
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

  const angle = Math.atan2(dy, dx)
  const headLen = Math.max(12, ctx.lineWidth * 4)

  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - headLen * Math.cos(angle - Math.PI / 6),
    to.y - headLen * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    to.x - headLen * Math.cos(angle + Math.PI / 6),
    to.y - headLen * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fill()
}

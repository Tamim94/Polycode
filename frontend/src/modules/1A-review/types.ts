export interface Point { x: number; y: number }

export interface BaseStroke {
  id: string
  clientId: string
  color: string
  width: number
  videoTime?: number  // set when drawn in temporal mode; undefined = always visible
}

export interface PenStroke extends BaseStroke {
  tool: 'pen'
  points: Point[]
}

export interface ArrowStroke extends BaseStroke {
  tool: 'arrow'
  from: Point
  to: Point
}

export interface RectStroke extends BaseStroke {
  tool: 'rect'
  x: number
  y: number
  w: number
  h: number
}

export type Stroke = PenStroke | ArrowStroke | RectStroke
export type ToolType = 'pen' | 'arrow' | 'rect'

export interface Comment {
  id: string
  clientId: string
  text: string
  videoTime: number  // seconds
  timestamp: number  // ms epoch
}

export interface SessionState {
  strokes: Stroke[]
  comments: Comment[]
}

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

export enum DrawMode {
  DRAWING = 'DRAWING',
  CURSOR = 'CURSOR',
  RESIZE = 'RESIZE',
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

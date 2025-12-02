import { Point, HandLandmark } from '../types';

export const calculateDistance = (p1: Point | HandLandmark, p2: Point | HandLandmark): number => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

// Simple linear interpolation
export const lerp = (start: number, end: number, factor: number): number => {
  return start + (end - start) * factor;
}

// Smooths points to make drawing less jittery using Linear Interpolation
export const getSmoothedPoint = (prev: Point, curr: Point, factor: number = 0.5): Point => {
  return {
    x: lerp(prev.x, curr.x, factor),
    y: lerp(prev.y, curr.y, factor),
  };
};

export const mapCoordinates = (point: Point, width: number, height: number): Point => {
  return {
    x: point.x * width,
    y: point.y * height,
  };
};

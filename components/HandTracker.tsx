import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Point, Stroke, DrawMode } from '../types';
import { calculateDistance, lerp } from '../utils/mathUtils';
import { HoloToolbar } from './HoloToolbar';
import { analyzeDrawing } from '../services/geminiService';

// --- CONFIGURATION FOR OFFLINE/ONLINE MODE ---
// To run offline:
// 1. Download 'hand_landmarker.task' and put it in your /public folder
// 2. Download 'vision_wasm_internal.wasm' (and .js) to /public/wasm folder
// 3. Set USE_LOCAL_MODELS = true;
const USE_LOCAL_MODELS = false; 

const MODEL_PATH = USE_LOCAL_MODELS 
  ? "/hand_landmarker.task" 
  : "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WASM_PATH = USE_LOCAL_MODELS 
  ? "/wasm" 
  : "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";


// Moved outside component to avoid re-creation and dependency issues
const drawSmoothStroke = (ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number, canvasWidth: number, canvasHeight: number) => {
  if (points.length < 2) return;
  
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  
  // Move to first point
  ctx.moveTo(points[0].x * canvasWidth, points[0].y * canvasHeight);
  
  // Simplified smooth drawing using Quadratic Curves
  if (points.length === 2) {
      ctx.lineTo(points[1].x * canvasWidth, points[1].y * canvasHeight);
  } else {
      for (let i = 1; i < points.length - 1; i++) {
           const p1 = points[i];   // current (control point)
           const p2 = points[i+1]; // next
           
           const cp = p1; // Control Point
           const ep = {   // End Point (Midpoint)
               x: (p1.x + p2.x) / 2,
               y: (p1.y + p2.y) / 2
           };
           
           ctx.quadraticCurveTo(
               cp.x * canvasWidth, cp.y * canvasHeight, 
               ep.x * canvasWidth, ep.y * canvasHeight
           );
      }
      // Connect the last bit
      const last = points[points.length - 1];
      ctx.lineTo(last.x * canvasWidth, last.y * canvasHeight);
  }
  ctx.stroke();
};

const HandTracker: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [landmarker, setLandmarker] = useState<HandLandmarker | null>(null);
  const [webcamRunning, setWebcamRunning] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const requestRef = useRef<number>();
  
  // App State (UI)
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState('#00f3ff');
  const [brushWidth, setBrushWidth] = useState(8);
  const [drawMode, setDrawMode] = useState<DrawMode>(DrawMode.DRAWING);
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState<Point>({ x: 0, y: 0 }); // New Pan State
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  
  // Refs for Animation Loop (Mutable state for performance/smoothness)
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Point[]>([]);
  const isPinchingRef = useRef(false);
  const pinchCooldownRef = useRef(0);
  
  // Dual Hand Gesture Refs
  const isDualGestureRef = useRef(false);
  const startGestureDistanceRef = useRef(0);
  const startGestureScaleRef = useRef(1);
  const startGestureMidpointRef = useRef<Point>({ x: 0, y: 0 });
  const startPanOffsetRef = useRef<Point>({ x: 0, y: 0 });

  // Smoothing Refs
  const smoothCursorRef = useRef<Point>({ x: 0, y: 0 });
  const smoothHand1Ref = useRef<Point>({ x: 0, y: 0 });
  const smoothHand2Ref = useRef<Point>({ x: 0, y: 0 });

  // Sync State to Refs
  const colorRef = useRef(color); colorRef.current = color;
  const brushWidthRef = useRef(brushWidth); brushWidthRef.current = brushWidth;
  const drawModeRef = useRef(drawMode); drawModeRef.current = drawMode;
  const scaleRef = useRef(scale); scaleRef.current = scale;
  const panOffsetRef = useRef(panOffset); panOffsetRef.current = panOffset;
  
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Initialize MediaPipe HandLandmarker
  useEffect(() => {
    const createLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2, // Enable 2 hands for multitouch
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6
        });
        setLandmarker(handLandmarker);
        setLoadingError(null);
      } catch (err) {
        console.error("Failed to load MediaPipe:", err);
        setLoadingError("Failed to load Holographic Core. Please check internet connection or model paths.");
      }
    };
    createLandmarker();
  }, []);

  // Start Webcam
  const enableCam = useCallback(async () => {
    if (!landmarker || !videoRef.current) return;

    if (webcamRunning) {
      setWebcamRunning(false);
      return;
    }

    try {
      const constraints = { video: { width: 1280, height: 720, facingMode: "user" } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener("loadeddata", predictWebcam);
      setWebcamRunning(true);
    } catch (err) {
      console.error("Error accessing webcam:", err);
      setLoadingError("Camera access denied. Please enable camera permissions.");
    }
  }, [landmarker, webcamRunning]);

  // Helper to safely save current stroke
  const saveCurrentStroke = () => {
      if (currentStrokeRef.current.length > 2) {
          const newStroke: Stroke = {
              points: [...currentStrokeRef.current],
              color: colorRef.current,
              width: brushWidthRef.current
          };
          strokesRef.current.push(newStroke);
          setStrokes(prev => [...prev, newStroke]);
      }
      currentStrokeRef.current = [];
      isPinchingRef.current = false;
      pinchCooldownRef.current = 0;
  };

  // Main Prediction Loop
  const predictWebcam = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !landmarker) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // --- RENDER START ---
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Apply Global Transform (Pan & Scale)
    ctx.translate(canvas.width / 2 + panOffsetRef.current.x, canvas.height / 2 + panOffsetRef.current.y);
    ctx.scale(scaleRef.current, scaleRef.current); 
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 10;

    // Draw completed strokes
    strokesRef.current.forEach(stroke => {
      drawSmoothStroke(ctx, stroke.points, stroke.color, stroke.width, canvas.width, canvas.height);
    });

    // Draw active stroke
    if (currentStrokeRef.current.length > 0) {
      drawSmoothStroke(ctx, currentStrokeRef.current, colorRef.current, brushWidthRef.current, canvas.width, canvas.height);
    }

    ctx.restore(); 
    // --- RENDER END ---

    // Detect Hands
    let startTimeMs = performance.now();
    
    if (video.currentTime > 0) {
      const results = landmarker.detectForVideo(video, startTimeMs);

      // --- FILTERING LOGIC ---
      let validLandmarks = results.landmarks || [];
      
      // Anti-Ghosting: If 2 hands are detected but wrists are extremely close, treat as one hand.
      if (validLandmarks.length === 2) {
          const w1 = validLandmarks[0][0];
          const w2 = validLandmarks[1][0];
          const wristDist = Math.hypot(w1.x - w2.x, w1.y - w2.y);
          if (wristDist < 0.15) {
              validLandmarks = [validLandmarks[0]];
          }
      }

      // --- DUAL HAND GESTURE LOGIC (PAN & ZOOM) ---
      if (validLandmarks.length === 2) {
        
        if (currentStrokeRef.current.length > 0) {
            saveCurrentStroke();
        }
        
        const hand1 = validLandmarks[0];
        const hand2 = validLandmarks[1];

        // Check Pinch for Both Hands
        const dist1 = calculateDistance(hand1[8], hand1[4]);
        const dist2 = calculateDistance(hand2[8], hand2[4]);
        
        const PINCH_THRESHOLD = 0.06;
        const isPinch1 = dist1 < PINCH_THRESHOLD;
        const isPinch2 = dist2 < PINCH_THRESHOLD;

        // Raw Coordinates
        const rawH1 = { x: 1 - hand1[8].x, y: hand1[8].y };
        const rawH2 = { x: 1 - hand2[8].x, y: hand2[8].y };

        // Smoothing
        const smoothingFactor = 0.25;
        if (smoothHand1Ref.current.x === 0) smoothHand1Ref.current = rawH1;
        if (smoothHand2Ref.current.x === 0) smoothHand2Ref.current = rawH2;

        const h1 = lerpPoint(smoothHand1Ref.current, rawH1, smoothingFactor);
        const h2 = lerpPoint(smoothHand2Ref.current, rawH2, smoothingFactor);
        
        smoothHand1Ref.current = h1;
        smoothHand2Ref.current = h2;

        const s1 = { x: h1.x * canvas.width, y: h1.y * canvas.height };
        const s2 = { x: h2.x * canvas.width, y: h2.y * canvas.height };

        // Draw Cursors
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;

        // Hand 1
        ctx.beginPath();
        ctx.arc(s1.x, s1.y, 10, 0, Math.PI * 2);
        if (isPinch1) { ctx.fillStyle = colorRef.current; ctx.fill(); }
        ctx.stroke();

        // Hand 2
        ctx.beginPath();
        ctx.arc(s2.x, s2.y, 10, 0, Math.PI * 2);
        if (isPinch2) { ctx.fillStyle = colorRef.current; ctx.fill(); }
        ctx.stroke();

        // LOGIC: ACTIVATE MANIPULATION ONLY IF BOTH PINCHING
        if (isPinch1 && isPinch2) {
            
            const currDist = Math.hypot(s1.x - s2.x, s1.y - s2.y);
            const currMid = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 };

            if (!isDualGestureRef.current) {
                // Start Gesture
                isDualGestureRef.current = true;
                startGestureDistanceRef.current = currDist;
                startGestureScaleRef.current = scaleRef.current;
                startGestureMidpointRef.current = currMid;
                startPanOffsetRef.current = { ...panOffsetRef.current };
            } else {
                // Update Gesture
                if (startGestureDistanceRef.current > 0) {
                    const scaleFactor = currDist / startGestureDistanceRef.current;
                    const newScale = Math.min(Math.max(0.5, startGestureScaleRef.current * scaleFactor), 3.0);
                    scaleRef.current = newScale;
                    setScale(newScale);
                }

                const deltaX = currMid.x - startGestureMidpointRef.current.x;
                const deltaY = currMid.y - startGestureMidpointRef.current.y;
                
                const newPan = {
                    x: startPanOffsetRef.current.x + deltaX,
                    y: startPanOffsetRef.current.y + deltaY
                };
                
                panOffsetRef.current = newPan;
                setPanOffset(newPan);
            }

            // Draw Connection Line
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            const grad = ctx.createLinearGradient(s1.x, s1.y, s2.x, s2.y);
            grad.addColorStop(0, '#00f3ff');
            grad.addColorStop(1, '#ff00ff');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 4;
            ctx.setLineDash([10, 10]);
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#fff';
            ctx.stroke();

        } else {
            // Deactivate if one releases
            isDualGestureRef.current = false;
        }
        
        ctx.restore();
        setCursorPos(null); 

      } 
      // --- SINGLE HAND DRAWING LOGIC ---
      else if (validLandmarks.length === 1) {
        // Reset Dual Gesture
        isDualGestureRef.current = false;
        smoothHand1Ref.current = {x:0, y:0};
        smoothHand2Ref.current = {x:0, y:0};

        const landmarks = validLandmarks[0];
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        
        const rawX = 1 - indexTip.x; 
        const rawY = indexTip.y;

        // --- SMOOTHING ALGORITHM ---
        const smoothingFactor = 0.25; 
        
        if (smoothCursorRef.current.x === 0 && smoothCursorRef.current.y === 0) {
            smoothCursorRef.current = { x: rawX, y: rawY };
        }

        const smoothX = lerp(smoothCursorRef.current.x, rawX, smoothingFactor);
        const smoothY = lerp(smoothCursorRef.current.y, rawY, smoothingFactor);
        
        smoothCursorRef.current = { x: smoothX, y: smoothY };
        // ---------------------------

        const screenX = smoothX * window.innerWidth;
        const screenY = smoothY * window.innerHeight;
        
        setCursorPos({ x: screenX, y: screenY });

        const distance = calculateDistance(indexTip, thumbTip);
        
        // --- PINCH HYSTERESIS ---
        const PINCH_START_THRESHOLD = 0.025;
        const PINCH_RELEASE_THRESHOLD = 0.05; 
        
        const currentlyPinching = isPinchingRef.current 
            ? distance < PINCH_RELEASE_THRESHOLD 
            : distance < PINCH_START_THRESHOLD;

        // Visual Cursor
        const cursorX = smoothX * canvas.width;
        const cursorY = smoothY * canvas.height;

        ctx.beginPath();
        ctx.arc(cursorX, cursorY, 15, 0, 2 * Math.PI);
        ctx.fillStyle = currentlyPinching ? colorRef.current : 'rgba(255, 255, 255, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (!currentlyPinching) {
             ctx.beginPath();
             ctx.moveTo(cursorX, cursorY);
             ctx.lineTo(cursorX, cursorY + 20); 
             ctx.stroke();
        }

        const isOverToolbar = screenX > (window.innerWidth - 300);

        if (drawModeRef.current === DrawMode.DRAWING && !isOverToolbar) {
          
          if (currentlyPinching) {
            pinchCooldownRef.current = 0; 
            
            // --- TRANSFORM SCREEN COORDINATES TO WORLD COORDINATES ---
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const ox = panOffsetRef.current.x;
            const oy = panOffsetRef.current.y;
            const s = scaleRef.current;

            const targetX = (cursorX - cx - ox) / s + cx;
            const targetY = (cursorY - cy - oy) / s + cy;

            const newPoint = {
                x: targetX / canvas.width,
                y: targetY / canvas.height
            };
            
            if (!isPinchingRef.current) {
              currentStrokeRef.current = [newPoint];
              isPinchingRef.current = true;
            } else {
              const lastPoint = currentStrokeRef.current[currentStrokeRef.current.length - 1];
              const dist = Math.hypot(newPoint.x - lastPoint.x, newPoint.y - lastPoint.y);
              
              if (dist > 0.005 / s) { 
                 currentStrokeRef.current.push(newPoint);
              }
            }
          } else {
             if (isPinchingRef.current) {
                 const COOLDOWN_FRAMES = 5; 
                 pinchCooldownRef.current += 1;
                 
                 if (pinchCooldownRef.current > COOLDOWN_FRAMES) {
                     saveCurrentStroke(); 
                 }
             }
          }
        }
      } else {
          // 0 Hands
          if (currentStrokeRef.current.length > 0) {
              saveCurrentStroke();
          }

          isDualGestureRef.current = false;
          setCursorPos(null);
      }
    }

    requestRef.current = requestAnimationFrame(predictWebcam);
  }, [landmarker]); 

  // Helper for internal lerp point
  const lerpPoint = (p1: Point, p2: Point, factor: number) => ({
      x: lerp(p1.x, p2.x, factor),
      y: lerp(p1.y, p2.y, factor)
  });

  useEffect(() => {
    if (webcamRunning) {
      requestRef.current = requestAnimationFrame(predictWebcam);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [webcamRunning, predictWebcam]);

  // Handle AI analysis
  const handleAIAnalyze = async () => {
    if (!canvasRef.current) return;
    setIsAiProcessing(true);
    setAiResponse(null);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasRef.current.width;
    tempCanvas.height = canvasRef.current.height;
    const tCtx = tempCanvas.getContext('2d');
    if (tCtx) {
        tCtx.fillStyle = '#000000';
        tCtx.fillRect(0,0, tempCanvas.width, tempCanvas.height);
        
        tCtx.translate(tempCanvas.width / 2 + panOffsetRef.current.x, tempCanvas.height / 2 + panOffsetRef.current.y);
        tCtx.scale(scaleRef.current, scaleRef.current); 
        tCtx.translate(-tempCanvas.width / 2, -tempCanvas.height / 2);
        
        tCtx.lineCap = 'round';
        tCtx.lineJoin = 'round';

        strokesRef.current.forEach(stroke => {
            drawSmoothStroke(tCtx, stroke.points, stroke.color, stroke.width, tempCanvas.width, tempCanvas.height);
        });
        
        const base64 = tempCanvas.toDataURL('image/png');
        const text = await analyzeDrawing(base64);
        setAiResponse(text);
    }
    setIsAiProcessing(false);
  };

  useEffect(() => {
      if (landmarker && !webcamRunning && !loadingError) {
          enableCam();
      }
  }, [landmarker, webcamRunning, enableCam, loadingError]);

  const handleClear = () => {
      setStrokes([]);
      strokesRef.current = [];
      setPanOffset({x: 0, y: 0});
      panOffsetRef.current = {x: 0, y: 0};
      setScale(1);
      scaleRef.current = 1;
      setAiResponse(null);
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full object-cover opacity-50 transform -scale-x-100"
        autoPlay
        playsInline
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full z-10"
      />
      {!landmarker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 text-holo-cyan font-mono">
          <div className="flex flex-col items-center gap-4">
             {loadingError ? (
               <div className="text-red-500 text-center max-w-md p-4 border border-red-500/50 rounded bg-red-900/20">
                 <p className="font-bold mb-2">SYSTEM ERROR</p>
                 <p>{loadingError}</p>
                 <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500">REBOOT SYSTEM</button>
               </div>
             ) : (
               <>
                 <div className="w-16 h-16 border-4 border-holo-cyan border-t-transparent rounded-full animate-spin"></div>
                 <p className="animate-pulse">INITIALIZING HOLOGRAPHIC CORE...</p>
               </>
             )}
          </div>
        </div>
      )}
      {landmarker && (
        <HoloToolbar
          color={color}
          setColor={setColor}
          width={brushWidth}
          setWidth={setBrushWidth}
          mode={drawMode}
          setMode={setDrawMode}
          onClear={handleClear}
          onAIAnalyze={handleAIAnalyze}
          isProcessing={isAiProcessing}
          scale={scale}
          setScale={setScale}
          cursorPos={cursorPos}
        />
      )}
      {aiResponse && (
        <div className="absolute bottom-10 left-10 max-w-md w-full px-4 z-40">
           <div className="bg-holo-dark/90 border border-holo-cyan p-6 rounded-xl shadow-[0_0_30px_rgba(0,243,255,0.3)] backdrop-blur-xl animate-in slide-in-from-bottom-5">
              <h3 className="text-holo-cyan text-xs font-bold font-mono mb-2 uppercase tracking-widest">System Analysis</h3>
              <p className="text-white font-light text-lg leading-relaxed font-sans">{aiResponse}</p>
              <button 
                onClick={() => setAiResponse(null)}
                className="absolute top-2 right-2 text-gray-500 hover:text-white"
              >
                ✕
              </button>
           </div>
        </div>
      )}
      <div className="absolute top-4 left-4 z-30 pointer-events-none hidden lg:block">
        <div className="bg-black/40 p-4 rounded-lg border border-white/10 text-xs font-mono text-gray-400">
          <p className="mb-1"><span className="text-holo-cyan">PINCH</span> 1 Hand to Draw</p>
          <p className="mb-1"><span className="text-holo-magenta">PINCH BOTH HANDS</span> to Move & Zoom</p>
          <p className="mb-1"><span className="text-green-400">HOVER</span> right side to Select</p>
        </div>
      </div>
    </div>
  );
};

export default HandTracker;
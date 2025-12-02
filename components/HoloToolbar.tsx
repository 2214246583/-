import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Scaling, Trash2, Wand2, Circle, Check } from 'lucide-react';
import { DrawMode, Point } from '../types';

interface HoloToolbarProps {
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  mode: DrawMode;
  setMode: (m: DrawMode) => void;
  onClear: () => void;
  onAIAnalyze: () => void;
  isProcessing: boolean;
  scale: number;
  setScale: (s: number) => void;
  cursorPos: Point | null; // Screen coordinates of the finger
}

const COLORS = ['#00f3ff', '#ff00ff', '#ffff00', '#00ff00', '#ffffff', '#ff0000'];
const SIZES = [4, 8, 16, 24];
const HOVER_THRESHOLD_MS = 1500; // 1.5 seconds to trigger

export const HoloToolbar: React.FC<HoloToolbarProps> = ({
  color,
  setColor,
  width,
  setWidth,
  mode,
  setMode,
  onClear,
  onAIAnalyze,
  isProcessing,
  scale,
  setScale,
  cursorPos
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const hoverStartTimeRef = useRef<number>(0);
  const triggerRef = useRef<boolean>(false);

  // Hover Detection Loop
  useEffect(() => {
    if (!cursorPos) {
      setHoveredId(null);
      setProgress(0);
      return;
    }

    const elements = document.querySelectorAll('[data-hover-id]');
    let foundId: string | null = null;

    // Check collision with interactive elements
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const rect = el.getBoundingClientRect();
      if (
        cursorPos.x >= rect.left &&
        cursorPos.x <= rect.right &&
        cursorPos.y >= rect.top &&
        cursorPos.y <= rect.bottom
      ) {
        foundId = el.getAttribute('data-hover-id');
        break;
      }
    }

    if (foundId) {
      if (hoveredId !== foundId) {
        // New hover started
        setHoveredId(foundId);
        hoverStartTimeRef.current = Date.now();
        triggerRef.current = false;
        setProgress(0);
      } else {
        // Continuing hover
        if (!triggerRef.current) {
          const elapsed = Date.now() - hoverStartTimeRef.current;
          const newProgress = Math.min(100, (elapsed / HOVER_THRESHOLD_MS) * 100);
          setProgress(newProgress);

          if (elapsed >= HOVER_THRESHOLD_MS) {
            // Trigger Action
            triggerRef.current = true;
            const el = document.querySelector(`[data-hover-id="${foundId}"]`) as HTMLElement;
            if (el) el.click();
            
            // Visual feedback for click
            setProgress(100);
            setTimeout(() => {
                 setHoveredId(null); 
                 setProgress(0);
                 hoverStartTimeRef.current = Date.now(); // Prevent immediate re-trigger
            }, 500);
          }
        }
      }
    } else {
      setHoveredId(null);
      setProgress(0);
      triggerRef.current = false;
    }
  }, [cursorPos, hoveredId]);

  const renderProgress = (id: string) => {
    if (hoveredId !== id) return null;
    return (
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-50">
         <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
             <circle 
                cx="50" cy="50" r="45" 
                fill="none" 
                stroke={progress >= 100 ? "#ffffff" : color} 
                strokeWidth="8"
                strokeDasharray="283"
                strokeDashoffset={283 - (283 * progress) / 100}
                className="transition-all duration-75 ease-linear opacity-80"
             />
         </svg>
      </div>
    );
  };

  return (
    <div className="absolute right-0 top-0 h-full w-48 md:w-64 bg-holo-dark/90 backdrop-blur-xl border-l border-holo-cyan/30 flex flex-col items-center py-6 gap-6 overflow-y-auto z-40 shadow-[-10px_0_30px_rgba(0,0,0,0.8)]">
      
      <div className="text-holo-cyan font-mono text-xs tracking-widest mb-2 border-b border-holo-cyan/30 w-full text-center pb-2">
        HOLO CONTROLS
      </div>

      {/* Colors */}
      <div className="flex flex-col gap-2 w-full px-4">
        <span className="text-gray-400 text-[10px] font-mono uppercase">Color Palette</span>
        <div className="grid grid-cols-2 gap-3">
          {COLORS.map((c) => (
            <button
              key={c}
              data-hover-id={`color-${c}`}
              onClick={() => setColor(c)}
              className={`relative w-16 h-16 rounded-2xl border-2 transition-all flex items-center justify-center group ${color === c ? 'border-white scale-105 shadow-[0_0_15px_' + c + ']' : 'border-white/10 opacity-70 hover:opacity-100'}`}
              style={{ backgroundColor: c }}
            >
              {renderProgress(`color-${c}`)}
              {color === c && <Check className="text-black drop-shadow-md" size={32} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full h-px bg-white/10 my-1" />

      {/* Brush Size */}
      <div className="flex flex-col gap-2 w-full px-4">
        <span className="text-gray-400 text-[10px] font-mono uppercase">Brush Size</span>
        <div className="flex flex-wrap gap-3 justify-center">
          {SIZES.map((s) => (
            <button
              key={s}
              data-hover-id={`size-${s}`}
              onClick={() => setWidth(s)}
              className={`relative w-14 h-14 rounded-xl border border-white/20 flex items-center justify-center bg-black/40 ${width === s ? 'ring-2 ring-holo-cyan bg-holo-cyan/10' : ''}`}
            >
              {renderProgress(`size-${s}`)}
              <div 
                className="rounded-full bg-white transition-all shadow-[0_0_10px_white]" 
                style={{ width: s, height: s, backgroundColor: color }} 
              />
            </button>
          ))}
        </div>
      </div>

      <div className="w-full h-px bg-white/10 my-1" />

      {/* Tools */}
      <div className="flex flex-col gap-3 w-full px-4">
        <span className="text-gray-400 text-[10px] font-mono uppercase">Tools</span>
        
        <button
          data-hover-id="mode-draw"
          onClick={() => setMode(DrawMode.DRAWING)}
          className={`relative w-full h-16 rounded-xl border flex items-center justify-center gap-3 transition-all ${mode === DrawMode.DRAWING ? 'bg-holo-cyan text-black border-holo-cyan font-bold' : 'bg-transparent text-holo-cyan border-holo-cyan/30'}`}
        >
          {renderProgress('mode-draw')}
          <Pencil size={24} />
          <span>DRAW</span>
        </button>

        <button
          data-hover-id="mode-resize"
          onClick={() => setMode(DrawMode.RESIZE)}
          className={`relative w-full h-16 rounded-xl border flex items-center justify-center gap-3 transition-all ${mode === DrawMode.RESIZE ? 'bg-holo-magenta text-black border-holo-magenta font-bold' : 'bg-transparent text-holo-magenta border-holo-magenta/30'}`}
        >
          {renderProgress('mode-resize')}
          <Scaling size={24} />
          <span>RESIZE</span>
        </button>

        <button
          data-hover-id="action-ai"
          onClick={onAIAnalyze}
          disabled={isProcessing}
          className={`relative w-full h-16 rounded-xl border flex items-center justify-center gap-3 transition-all ${isProcessing ? 'bg-gray-800 border-gray-700 text-gray-500' : 'bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-white/30 text-white'}`}
        >
          {renderProgress('action-ai')}
          <Wand2 size={24} className={isProcessing ? 'animate-spin' : ''} />
          <span>{isProcessing ? '...' : 'AI SCAN'}</span>
        </button>

        <button
          data-hover-id="action-clear"
          onClick={onClear}
          className="relative w-full h-16 rounded-xl border border-red-500/30 text-red-400 bg-red-900/20 flex items-center justify-center gap-3 hover:bg-red-500/20"
        >
          {renderProgress('action-clear')}
          <Trash2 size={24} />
          <span>CLEAR</span>
        </button>
      </div>

       {/* Scale Instructions (Simplified) */}
       <div className="mt-auto mb-4 px-4 w-full">
         <div className="text-center text-[10px] text-gray-500 font-mono">
            SCALE: {(scale * 100).toFixed(0)}%
            <div className="flex justify-between mt-2">
                 <button data-hover-id="scale-down" onClick={() => setScale(Math.max(0.5, scale - 0.1))} className="w-8 h-8 rounded border border-white/20 flex items-center justify-center relative">
                    {renderProgress('scale-down')} - 
                 </button>
                 <button data-hover-id="scale-up" onClick={() => setScale(Math.min(2.0, scale + 0.1))} className="w-8 h-8 rounded border border-white/20 flex items-center justify-center relative">
                    {renderProgress('scale-up')} + 
                 </button>
            </div>
         </div>
       </div>

    </div>
  );
};

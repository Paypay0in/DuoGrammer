import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

interface HandwritingCanvasProps {
  width: string | number;
  height: number;
  color: string;
  radius: number;
  isHighlighter?: boolean;
  className?: string;
}

export interface HandwritingCanvasRef {
  clear: () => void;
  undo: () => void;
  getSaveData: () => string;
  loadSaveData: (data: string) => void;
}

const HandwritingCanvas = forwardRef<HandwritingCanvasRef, HandwritingCanvasProps>(({
  width,
  height,
  color,
  radius,
  isHighlighter = false,
  className
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [isStraightLineMode, setIsStraightLineMode] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const lastStrokeState = useRef<string | null>(null);
  const currentPosRef = useRef({ x: 0, y: 0 });

  // Sync internal resolution with CSS size to fix offset
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      // Only update if size actually changed to avoid clearing canvas unnecessarily
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        // Save current content before resizing as resizing clears the canvas
        const tempData = canvas.toDataURL();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        // Restore content
        const img = new Image();
        img.src = tempData;
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
        };
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const getCoordinates = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Since we synced internal width/height with rect.width/height, 
    // the coordinates are direct.
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    // Save current state to history
    const currentState = canvas.toDataURL();
    setHistory(prev => [...prev, currentState]);
    lastStrokeState.current = currentState;

    const { x, y } = getCoordinates(e);
    setStartPos({ x, y });
    currentPosRef.current = { x, y };
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;
    
    if (color === 'transparent') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = '#ffffff';
    } else if (isHighlighter) {
      ctx.globalCompositeOperation = 'source-over'; 
      ctx.globalAlpha = 0.4; // Lower alpha for better transparency
      ctx.strokeStyle = color;
      ctx.lineWidth = radius * 8;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = color;
    }

    setIsDrawing(true);
    setIsStraightLineMode(false);
    (e.target as Element).setPointerCapture(e.pointerId);

    // Start long press timer
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setIsStraightLineMode(true);
      snapToStraightLine(x, y, currentPosRef.current.x, currentPosRef.current.y);
    }, 700);
  };

  const snapToStraightLine = (x1: number, y1: number, x2: number, y2: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !lastStrokeState.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = lastStrokeState.current;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
  };

  const draw = (e: React.PointerEvent | PointerEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    const dx = Math.abs(x - currentPosRef.current.x);
    const dy = Math.abs(y - currentPosRef.current.y);

    // If moved significantly, reset long press timer
    if (dx > 2 || dy > 2) {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        if (!isStraightLineMode) {
          longPressTimer.current = setTimeout(() => {
            setIsStraightLineMode(true);
            snapToStraightLine(startPos.x, startPos.y, currentPosRef.current.x, currentPosRef.current.y);
          }, 700);
        }
      }
    }

    currentPosRef.current = { x, y };

    if (isStraightLineMode) {
      snapToStraightLine(startPos.x, startPos.y, x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = (e: React.PointerEvent | PointerEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    
    setIsDrawing(false);
    setIsStraightLineMode(false);
    lastStrokeState.current = null;
    if (e.pointerId !== undefined) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore errors if pointer capture was already released
      }
    }
  };

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHistory([]);
    },
    undo: () => {
      if (history.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const lastState = history[history.length - 1];
      const img = new Image();
      img.src = lastState;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        setHistory(prev => prev.slice(0, -1));
      };
    },
    getSaveData: () => {
      return canvasRef.current?.toDataURL() || '';
    },
    loadSaveData: (data: string) => {
      if (!data) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.src = data;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
    }
  }));

  return (
    <canvas
      ref={canvasRef}
      className={`${className || ''} select-none`}
      style={{ 
        width: '100%', 
        height: `${height}px`, 
        touchAction: 'none',
        background: 'transparent',
        backgroundColor: 'transparent',
        display: 'block',
        userSelect: 'none',
        WebkitUserSelect: 'none'
      }}
      onPointerDown={(e) => {
        startDrawing(e);
      }}
      onPointerMove={draw}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
      onPointerOut={stopDrawing}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});

HandwritingCanvas.displayName = 'HandwritingCanvas';

export default HandwritingCanvas;

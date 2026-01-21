import { ZoomOut, ZoomIn, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";

// Zoom Controls Component
interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export const ZoomControls = ({ zoom, onZoomIn, onZoomOut, onZoomReset }: ZoomControlsProps) => {
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 group">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100/90 backdrop-blur-xl rounded-full shadow-lg border border-gray-300/50 translate-y-[calc(-100%-8px)] group-hover:translate-y-[20px] transition-transform duration-300 ease-out">
      <Button 
        size="icon" 
        variant="ghost" 
        onClick={onZoomOut} 
        title="Zoom Out"
        className="h-7 w-7 hover:bg-gray-200/60 text-gray-700 hover:text-gray-900"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </Button>
      <span className="text-xs text-gray-800 min-w-[2.5rem] text-center font-medium tabular-nums">{zoom}%</span>
      <Button 
        size="icon" 
        variant="ghost" 
        onClick={onZoomIn} 
        title="Zoom In"
        className="h-7 w-7 hover:bg-gray-200/60 text-gray-700 hover:text-gray-900"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </Button>
      <div className="w-px h-4 bg-gray-300/60 mx-0.5" />
      <Button 
        size="icon" 
        variant="ghost" 
        onClick={onZoomReset} 
        title="Reset Zoom"
        className="h-7 w-7 hover:bg-gray-200/60 text-gray-700 hover:text-gray-900"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </Button>
      </div>
    </div>
  );
}
import React from "react";
import { motion } from "framer-motion";

type HaloProps = {
  className?: string;
  /** Overall opacity for the halos (0.0 - 1.0) */
  opacity?: number;
  /** Additional blur in pixels applied to each halo layer */
  blurPx?: number;
  /** Whether to render as fixed (fullscreen) or relative to parent */
  fixed?: boolean;
  /** Animation speed multiplier; 1 = normal, 0.5 = slower, 2 = faster */
  speed?: number;
};

/**
 * Animated halo background with three softly-blurred color blobs.
 * Colors: orange-500, red-500, emerald-500.
 * Designed to sit behind content. Parent should be `relative` if not fixed.
 */
const Halo: React.FC<HaloProps> = ({
  className,
  opacity = 0.6,
  blurPx = 80,
  fixed = false,
  speed = 5,
}) => {
  const containerClass = fixed
    ? "pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    : "pointer-events-none absolute inset-0 -z-10 overflow-hidden";

  const commonHaloClass = "absolute rounded-full mix-blend-screen";

  const commonStyle: React.CSSProperties = {
    filter: `blur(${blurPx}px)`,
    opacity,
    willChange: "transform, opacity",
  };

  // Convert speed multiplier into duration scale: lower speed => longer duration
  const durationScale = Math.max(0.01, speed);

  return (
    <div className={[containerClass, className].filter(Boolean).join(" ")}> 
      {/* Orange halo */}
      <motion.div
        aria-hidden
        className={[commonHaloClass].join(" ")}
        style={{
          ...commonStyle,
          width: "44rem",
          height: "44rem",
          left: "-10%",
          top: "-20%",
          // soft radial gradient for smoother merging
          background:
            "radial-gradient(closest-side, rgba(255,237,213,0.9), rgba(255,237,213,0.45), rgba(255,237,213,0.0) 60%)",
        }}
        initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
        animate={{
          x: [0, 80, -40, 0],
          y: [0, -60, 40, 0],
          scale: [1, 1.1, 0.95, 1],
          rotate: [0, 10, -8, 0],
        }}
        transition={{ duration: 28 / durationScale, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Red halo */}
      <motion.div
        aria-hidden
        className={[commonHaloClass].join(" ")}
        style={{
          ...commonStyle,
          width: "36rem",
          height: "36rem",
          right: "-12%",
          top: "10%",
          background:
            "radial-gradient(closest-side, rgba(254,226,226,0.9), rgba(254,226,226,0.45), rgba(254,226,226,0.0) 70%)",
        }}
        initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
        animate={{
          x: [0, -70, 60, 0],
          y: [0, 40, -50, 0],
          scale: [1, 0.9, 1.05, 1],
          rotate: [0, -12, 6, 0],
        }}
        transition={{ duration: 32 / durationScale, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Emerald halo */}
      <motion.div
        aria-hidden
        className={[commonHaloClass].join(" ")}
        style={{
          ...commonStyle,
          width: "50rem",
          height: "50rem",
          left: "10%",
          bottom: "-18%",
          background:
            "radial-gradient(closest-side, rgba(209,250,229,0.9), rgba(209,250,229,0.45), rgba(209,250,229,0.0) 40%)",
        }}
        initial={{ x: 0, y: 0, scale: 1, rotate: 0 }}
        animate={{
          x: [0, 40, -60, 0],
          y: [0, -30, 50, 0],
          scale: [1, 1.08, 0.92, 1],
          rotate: [0, 8, -10, 0],
        }}
        transition={{ duration: 36 / durationScale, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
};

export default Halo;



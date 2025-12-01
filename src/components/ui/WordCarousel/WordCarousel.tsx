import React, { useEffect, useMemo, useState } from "react";
import "./WordCarousel.css";

export type WordCarouselProps = {
  words: string[];
  className?: string;
  rotateIntervalMs?: number;
  sweepDurationMs?: number;
  gradient?: string;
  ariaLabel?: string;
  sweepOnce?: boolean;
};

export function WordCarousel({
  words,
  className,
  rotateIntervalMs = 1600,
  sweepDurationMs = 2200,
  gradient,
  ariaLabel,
  sweepOnce = false,
}: WordCarouselProps) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  const safeWords = useMemo(() => (words && words.length > 0 ? words : [""]), [words]);

  useEffect(() => {
    if (safeWords.length <= 1) return;
    const interval = setInterval(() => {
      setFading(true);
      const timeout = setTimeout(() => {
        setIndex((prev) => (prev + 1) % safeWords.length);
        setFading(false);
      }, Math.min(300, Math.max(150, rotateIntervalMs * 0.25)));
      return () => clearTimeout(timeout);
    }, rotateIntervalMs);
    return () => clearInterval(interval);
  }, [rotateIntervalMs, safeWords.length]);

  const gradientValue = useMemo(
    () =>
      gradient ??
      "linear-gradient(in oklch 90deg, #1d1d1d 0%, #1d1d1d 30%, #FF0099 35%, #FF0000 45%, #FF4F04 50%, #FFA600 55%, #F8F8F8 60%, #0056FF 65%, #f9f8f6 70%, #f9f8f6 100%)",
    [gradient]
  );

  const style: React.CSSProperties = {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- CSS var is fine here
    "--word-gradient": gradientValue,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- CSS var is fine here
    "--sweep-duration": `${sweepDurationMs}ms`,
  } as React.CSSProperties;

  return (
    <span
      className={["word-carousel", sweepOnce ? "sweep-once" : "", fading ? "is-fading" : "", className ?? ""].join(" ").trim()}
      aria-label={ariaLabel}
      style={style}
    >
      {safeWords[index]}
    </span>
  );
}

export default WordCarousel;


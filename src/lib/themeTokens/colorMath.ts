// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHue(degrees: number): number {
  let h = degrees % 360;
  if (h < 0) h += 360;
  return h;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '').trim();
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): `#${string}` {
  const toHex = (value: number) =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// mix(a,b,t): t=0 => a, t=1 => b
export function mix(colorA: string, colorB: string, t: number): `#${string}` {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const weight = clamp(t, 0, 1);
  return rgbToHex(
    a.r + (b.r - a.r) * weight,
    a.g + (b.g - a.g) * weight,
    a.b + (b.b - a.b) * weight
  );
}

export function alpha(hex: string, opacity: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1).toFixed(3)})`;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(linear: number): number {
  const clamped = clamp(linear, 0, 1);
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = luminance(colorA);
  const lumB = luminance(colorB);
  const [high, low] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (high + 0.05) / (low + 0.05);
}

export function chooseReadableText(
  background: string,
  preferred: string,
  minimumContrast = 4.5
): `#${string}` {
  if (contrastRatio(preferred, background) >= minimumContrast) {
    return preferred as `#${string}`;
  }
  const black: `#${string}` = '#111111';
  const white: `#${string}` = '#ffffff';
  return contrastRatio(black, background) >= contrastRatio(white, background)
    ? black
    : white;
}

export type Oklch = {
  l: number; // 0..1
  c: number; // >= 0
  h: number; // 0..360
};

export type Oklab = {
  l: number;
  a: number;
  b: number;
};

function srgbHexToLinearRgb(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return {
    r: srgbToLinear(r),
    g: srgbToLinear(g),
    b: srgbToLinear(b),
  };
}

function linearRgbToHex(rgb: {
  r: number;
  g: number;
  b: number;
}): `#${string}` {
  return rgbToHex(
    linearToSrgb(rgb.r) * 255,
    linearToSrgb(rgb.g) * 255,
    linearToSrgb(rgb.b) * 255
  );
}

function linearRgbToOklab(rgb: { r: number; g: number; b: number }): Oklab {
  const l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
  const m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
  const s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRgb(oklab: Oklab): { r: number; g: number; b: number } {
  const l_ = oklab.l + 0.3963377774 * oklab.a + 0.2158037573 * oklab.b;
  const m_ = oklab.l - 0.1055613458 * oklab.a - 0.0638541728 * oklab.b;
  const s_ = oklab.l - 0.0894841775 * oklab.a - 1.291485548 * oklab.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function hexToOklch(hex: string): Oklch {
  const oklab = linearRgbToOklab(srgbHexToLinearRgb(hex));
  const c = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
  const h = normalizeHue((Math.atan2(oklab.b, oklab.a) * 180) / Math.PI);
  return {
    l: clamp(oklab.l, 0, 1),
    c: Math.max(0, c),
    h,
  };
}

function oklchToOklab(color: Oklch): Oklab {
  const hRad = (normalizeHue(color.h) * Math.PI) / 180;
  return {
    l: clamp(color.l, 0, 1),
    a: Math.max(0, color.c) * Math.cos(hRad),
    b: Math.max(0, color.c) * Math.sin(hRad),
  };
}

function isLinearRgbInSrgbGamut(rgb: {
  r: number;
  g: number;
  b: number;
}): boolean {
  return (
    rgb.r >= 0 &&
    rgb.r <= 1 &&
    rgb.g >= 0 &&
    rgb.g <= 1 &&
    rgb.b >= 0 &&
    rgb.b <= 1
  );
}

export function deltaEOK(a: Oklch, b: Oklch): number {
  const la = oklchToOklab(a);
  const lb = oklchToOklab(b);
  const dl = la.l - lb.l;
  const da = la.a - lb.a;
  const db = la.b - lb.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function oklchToHex(input: Oklch): `#${string}` {
  const normalized: Oklch = {
    l: clamp(input.l, 0, 1),
    c: Math.max(0, input.c),
    h: normalizeHue(input.h),
  };

  const candidateRgb = oklabToLinearRgb(oklchToOklab(normalized));
  if (isLinearRgbInSrgbGamut(candidateRgb)) {
    return linearRgbToHex(candidateRgb);
  }

  // Gamut mapping by chroma reduction (binary search, local minimum deltaEOK).
  const start = normalized;
  let low = 0;
  let high = normalized.c;
  let best = { ...normalized, c: 0 };
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const probe = { ...normalized, c: mid };
    const probeRgb = oklabToLinearRgb(oklchToOklab(probe));
    if (isLinearRgbInSrgbGamut(probeRgb)) {
      best = probe;
      low = mid;
    } else {
      high = mid;
    }
  }

  // Keep the in-gamut candidate with smallest deltaEOK to requested color.
  const edgeA = { ...normalized, c: low };
  const edgeB = { ...normalized, c: Math.max(0, low - 0.0005) };
  const bestFinal =
    deltaEOK(start, edgeA) <= deltaEOK(start, edgeB) ? edgeA : edgeB;
  return linearRgbToHex(oklabToLinearRgb(oklchToOklab(bestFinal)));
}

export function wcagMinimumContrast(largeText?: boolean): number {
  return largeText ? 3 : 4.5;
}

export function apcaContrastApprox(textHex: string, bgHex: string): number {
  const yText = luminance(textHex);
  const yBg = luminance(bgHex);
  const polarity = yBg >= yText ? 1 : -1;
  // Lightweight APCA-like diagnostic curve (non-gating for this release).
  const bgExp = yBg >= yText ? 0.56 : 0.65;
  const textExp = yBg >= yText ? 0.57 : 0.62;
  const lc = (yBg ** bgExp - yText ** textExp) * 1.14 * 100;
  return polarity * lc;
}

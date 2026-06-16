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

import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useRef, useState } from 'react';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(input: string): `#${string}` | null {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!HEX_COLOR_RE.test(candidate)) return null;
  return candidate.toLowerCase() as `#${string}`;
}

function hsvToHex(h: number, s: number, v: number): `#${string}` {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}` as `#${string}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, v];
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const initHex = normalizeHexColor(value) ?? '#6366f1';
  const [hue, setHue] = useState(() => hexToHsv(initHex)[0]);
  const [sat, setSat] = useState(() => hexToHsv(initHex)[1]);
  const [val, setVal] = useState(() => hexToHsv(initHex)[2]);
  const [hexDraft, setHexDraft] = useState<string>(initHex);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const currentHex = hsvToHex(hue, sat, val);

  useEffect(() => {
    setHexDraft(currentHex);
    onChangeRef.current(currentHex);
  }, [hue, sat, val, currentHex]);

  const handleHexInput = (raw: string) => {
    setHexDraft(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) {
      const [h, s, v] = hexToHsv(normalized);
      setHue(h);
      setSat(s);
      setVal(v);
    }
  };

  const handleSvPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.type === 'pointerdown')
        e.currentTarget.setPointerCapture(e.pointerId);
      if (e.type !== 'pointerdown' && !(e.buttons & 1)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setSat(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
      setVal(
        1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      );
    },
    []
  );

  const handleHuePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.type === 'pointerdown')
        e.currentTarget.setPointerCapture(e.pointerId);
      if (e.type !== 'pointerdown' && !(e.buttons & 1)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setHue(
        Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360))
      );
    },
    []
  );

  const hueHex = hsvToHex(hue, 1, 1);

  return (
    <div className="gap-3 flex flex-col select-none">
      <div
        className="h-40 rounded-lg relative w-full cursor-crosshair overflow-hidden"
        style={{ backgroundColor: hueHex }}
        onPointerDown={handleSvPointer}
        onPointerMove={handleSvPointer}
      >
        <div
          className="inset-0 pointer-events-none absolute"
          style={{ background: 'linear-gradient(to right, #fff, transparent)' }}
        />
        <div
          className="inset-0 pointer-events-none absolute"
          style={{
            background: 'linear-gradient(to bottom, transparent, #000)',
          }}
        />
        <div
          className="h-4 w-4 border-ds-border-neutral-default-default bg-white shadow-lg pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${sat * 100}%`,
            top: `${(1 - val) * 100}%`,
          }}
        />
      </div>

      <div
        className="h-4 relative w-full cursor-pointer overflow-hidden rounded-full"
        style={{
          background:
            'linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)',
        }}
        onPointerDown={handleHuePointer}
        onPointerMove={handleHuePointer}
      >
        <div
          className="h-5 w-5 border-ds-border-neutral-default-default bg-white shadow-lg pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${(hue / 360) * 100}%`,
          }}
        />
      </div>

      <div className="gap-2 flex items-center">
        <div
          className="h-8 w-8 rounded-md border-ds-border-neutral-default-default flex-shrink-0 border border-solid"
          style={{ backgroundColor: currentHex }}
        />
        <Input
          size="sm"
          value={hexDraft}
          onChange={(e) => handleHexInput(e.target.value)}
          placeholder="#000000"
          className="font-mono flex-1"
        />
      </div>
    </div>
  );
}

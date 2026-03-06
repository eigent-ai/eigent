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

import { UDocClient } from '@docmentis/udoc-viewer';
import { useEffect, useRef, useState } from 'react';

export type PptxSlide = {
  index: number;
  html: string;
};

type PptxViewerProps = {
  dataUrl: string;
  fileName?: string;
  className?: string;
};

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function PptxViewer({
  dataUrl,
  fileName,
  className = '',
}: PptxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<{ destroy: () => void } | null>(null);
  const viewerRef = useRef<{ destroy: () => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      setError('Invalid file data');
      setLoading(false);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const client = await UDocClient.create({ telemetry: false });
        if (cancelled) {
          client.destroy();
          return;
        }
        clientRef.current = client;

        const viewer = await client.createViewer({
          container,
          googleFonts: true,
        });
        if (cancelled) {
          viewer.destroy();
          client.destroy();
          return;
        }
        viewerRef.current = viewer;

        const bytes = dataUrlToUint8Array(dataUrl);
        await viewer.load(bytes);

        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Failed to load presentation'
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (_) {}
        viewerRef.current = null;
      }
      if (clientRef.current) {
        try {
          clientRef.current.destroy();
        } catch (_) {}
        clientRef.current = null;
      }
    };
  }, [dataUrl]);

  if (error) {
    return (
      <div
        className={`text-destructive flex h-full items-center justify-center ${className}`}
      >
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${className}`}>
      {loading && (
        <div className="flex h-full items-center justify-center text-text-secondary">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="text-sm">Loading presentation…</p>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="h-full min-h-0 w-full flex-1"
        style={{ visibility: loading ? 'hidden' : 'visible' }}
        aria-label="PPTX document viewer"
      />
      {fileName && !loading && (
        <div className="flex-shrink-0 border-t border-border-subtle px-4 py-1 text-xs text-text-tertiary">
          {fileName}
        </div>
      )}
    </div>
  );
}

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

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker in the same module where we use Document/Page
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const DEFAULT_PAGE_HEIGHT = 1056;

interface LazyPageProps {
  pageNumber: number;
  width: number | undefined;
}

const LazyPage = memo(function LazyPage({ pageNumber, width }: LazyPageProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {visible ? (
        <Page
          pageNumber={pageNumber}
          width={width}
          className="mb-4 shadow-md"
        />
      ) : (
        <div
          className="bg-background-secondary mb-4"
          style={{ height: width ? width * 1.414 : DEFAULT_PAGE_HEIGHT }}
        />
      )}
    </div>
  );
});

interface PdfViewerProps {
  /** data URL (data:application/pdf;base64,...) or file path */
  content: string;
}

export default function PdfViewer({ content }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      setLoadError(null);
    },
    []
  );

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('Failed to load PDF document:', error);
    setLoadError(error.message ?? 'Failed to load PDF.');
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-4">
      {loadError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-secondary">
          <p className="text-sm font-medium">Failed to load PDF</p>
          <p className="max-w-xs text-center text-xs text-text-tertiary">
            {loadError}
          </p>
        </div>
      ) : (
        <Document
          file={content}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
        >
          {Array.from({ length: numPages }, (_, index) => (
            <LazyPage
              key={`page_${index + 1}`}
              pageNumber={index + 1}
              width={containerWidth || undefined}
            />
          ))}
        </Document>
      )}
    </div>
  );
}

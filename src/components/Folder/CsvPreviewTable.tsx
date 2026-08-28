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

import { Button } from '@/components/ui/button';
import {
  formatFileSize,
  type CsvFilePreview,
} from '@/shared/filePreviewContract';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ROW_PAGE_SIZE = 100;

export function CsvPreviewTable({ preview }: { preview: CsvFilePreview }) {
  const { t } = useTranslation();
  const [visibleRows, setVisibleRows] = useState(ROW_PAGE_SIZE);
  useEffect(() => setVisibleRows(ROW_PAGE_SIZE), [preview]);

  const rows = preview.rows.slice(0, visibleRows);
  const remaining = Math.max(0, preview.rows.length - rows.length);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <div className="rounded-lg bg-ds-neutral-subtle-default px-3 py-2 text-ds-text-meta text-ds-ink-muted-default">
        {t('layout.csv-preview-summary', {
          rows: t('layout.csv-row-count', {
            count: preview.rows.length,
            formattedCount: preview.rows.length.toLocaleString(),
            defaultValue_one: '{{formattedCount}} row',
            defaultValue_other: '{{formattedCount}} rows',
          }),
          columns: t('layout.csv-column-count', {
            count: preview.columns.length,
            formattedCount: preview.columns.length.toLocaleString(),
            defaultValue_one: '{{formattedCount}} column',
            defaultValue_other: '{{formattedCount}} columns',
          }),
          bytesRead: formatFileSize(preview.bytesRead),
          totalBytes:
            preview.totalBytes !== null
              ? t('layout.csv-total-size', {
                  size: formatFileSize(preview.totalBytes),
                  defaultValue: ' of {{size}}',
                })
              : '',
          truncation: preview.truncated
            ? t('layout.csv-preview-truncated', {
                defaultValue: ' The complete file was not loaded.',
              })
            : '',
          defaultValue:
            'Previewing {{rows}} and {{columns}} from {{bytesRead}}{{totalBytes}}.{{truncation}}',
        })}
      </div>

      {preview.columns.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center text-ds-text-base text-ds-ink-muted-default">
          {t('layout.csv-no-previewable-rows', {
            defaultValue: 'This CSV does not contain any previewable rows.',
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-x border-y border-solid border-ds-hairline-subtle-default">
          <table className="min-w-full border-collapse text-left text-ds-text-meta">
            <thead className="sticky top-0 z-10 bg-ds-neutral-default-default">
              <tr>
                {preview.columns.map((column, index) => (
                  <th
                    key={`${index}-${column}`}
                    className="max-w-64 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-3 py-2 font-semibold text-ds-ink-default-default"
                    title={column}
                  >
                    <span className="block truncate">{column}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-ds-neutral-subtle-default">
                  {row.map((cell, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="max-w-64 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-3 py-2 align-top text-ds-ink-default-default"
                      title={cell}
                    >
                      <span className="block max-h-20 overflow-hidden break-words whitespace-pre-wrap">
                        {cell}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {remaining > 0 ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() =>
            setVisibleRows((count) =>
              Math.min(count + ROW_PAGE_SIZE, preview.rows.length)
            )
          }
        >
          {t('layout.csv-show-more-rows', {
            count: Math.min(ROW_PAGE_SIZE, remaining),
            defaultValue_one: 'Show {{count}} more row',
            defaultValue_other: 'Show {{count}} more rows',
          })}
        </Button>
      ) : null}
    </div>
  );
}

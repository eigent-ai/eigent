import { pdfPreviewUrl } from '@/components/Folder/PdfPreview';
import { expect, it } from 'vitest';
it('retains authorization and gives the native viewer a filename and width fit', () => {
  const url = new URL(
    pdfPreviewUrl(
      'http://localhost:5001/files/stream?path=a%2Fb.pdf&project_id=p',
      '中文 report.pdf'
    )
  );
  expect(decodeURIComponent(url.pathname)).toBe(
    '/files/stream/中文 report.pdf'
  );
  expect(url.searchParams.get('path')).toBe('a/b.pdf');
  expect(url.hash).toBe('#view=FitH');
});
it('keeps signed remote URLs and explicit zoom intact', () => {
  expect(
    pdfPreviewUrl(
      'https://example.com/file?signature=secret#zoom=125',
      'report.pdf'
    )
  ).toBe('https://example.com/file?signature=secret#zoom=125');
});

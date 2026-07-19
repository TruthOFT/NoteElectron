import { BrowserWindow } from 'electron';
import type { PdfExportRequest } from './pdfIpc';

const MIN_PAGE_SIZE = 72;
const MAX_PAGE_SIZE = 16_384;

function clampPageSize(value: number) {
  if (!Number.isFinite(value)) return MIN_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(value)));
}

function createPrintHtml(request: PdfExportRequest) {
  const width = clampPageSize(request.width);
  const height = clampPageSize(request.height);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      @page { size: ${width}px ${height}px; margin: 0; }
      html, body { width: ${width}px; height: ${height}px; margin: 0; overflow: hidden; background: white; }
      svg { display: block; width: ${width}px; height: ${height}px; }
    </style>
  </head>
  <body>${request.svg}</body>
</html>`;
}

export async function renderVectorPdf(request: PdfExportRequest) {
  const exportWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
    },
  });

  try {
    const html = createPrintHtml(request);
    await exportWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`,
    );
    return await exportWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    exportWindow.destroy();
  }
}

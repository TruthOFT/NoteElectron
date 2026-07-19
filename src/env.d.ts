/// <reference types="vite/client" />

import type { PdfExportRequest, PdfExportResult } from './export/pdfIpc';

declare global {
  interface Window {
    noteElectron: {
      exportPdf: (request: PdfExportRequest) => Promise<PdfExportResult>;
    };
  }
}

export {};

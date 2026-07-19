import { contextBridge, ipcRenderer } from 'electron';
import {
  PDF_EXPORT_CHANNEL,
  type PdfExportRequest,
  type PdfExportResult,
} from './export/pdfIpc';

contextBridge.exposeInMainWorld('noteElectron', {
  exportPdf: (request: PdfExportRequest): Promise<PdfExportResult> =>
    ipcRenderer.invoke(PDF_EXPORT_CHANNEL, request),
});

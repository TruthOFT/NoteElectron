export const PDF_EXPORT_CHANNEL = 'note:export-pdf';

export type PdfExportRequest = {
  svg: string;
  width: number;
  height: number;
};

export type PdfExportResult = {
  canceled: boolean;
  filePath?: string;
};

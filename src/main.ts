import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { renderVectorPdf } from './export/pdfDocument';
import {
  PDF_EXPORT_CHANNEL,
  type PdfExportRequest,
  type PdfExportResult,
} from './export/pdfIpc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

ipcMain.handle(
  PDF_EXPORT_CHANNEL,
  async (event, request: PdfExportRequest): Promise<PdfExportResult> => {
    if (!request.svg.startsWith('<svg')) {
      throw new Error('PDF export requires SVG content.');
    }

    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '导出 PDF',
      defaultPath: `笔记-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };

    const pdf = await renderVectorPdf(request);
    await writeFile(result.filePath, pdf);
    return { canceled: false, filePath: result.filePath };
  },
);

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Note Electron',
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

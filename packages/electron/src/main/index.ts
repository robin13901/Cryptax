import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { resolveDbPath, resolveMigrationsPath } from './db-path.js';
import { startBackendServer, stopBackendServer } from './server.js';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  // 1. Resolve database and migration paths BEFORE importing backend
  const dbPath = resolveDbPath();
  const migrationsPath = resolveMigrationsPath();

  // 2. Call initDb() explicitly with both paths before startBackendServer().
  //    This is the ONLY approach — do not use process.env.DB_PATH.
  //    initDb() must be called before any dynamic import of backend modules
  //    so the database is initialized at the correct path before createApp() runs.
  const { initDb } = await import('@cryptax/backend/db/client.js');
  initDb({ dbPath, migrationsPath });

  // 3. Start the embedded Hono backend server
  await startBackendServer(3001);

  // 4. Trigger the tax engine background run after server starts
  try {
    const { triggerEngineBackground } = await import('@cryptax/backend/routes/engine.js');
    triggerEngineBackground();
  } catch {
    // Non-critical — engine will run on first manual trigger
    console.warn('[electron] Background engine trigger skipped');
  }

  // 5. Create the BrowserWindow
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Cryptax',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, // DEFAULT — never disable
      nodeIntegration: false, // DEFAULT — never enable
      sandbox: true, // DEFAULT since Electron 20
    },
  });

  // 6. Load the frontend
  //    In dev: electron-vite sets ELECTRON_RENDERER_URL
  //    In prod: load the bundled index.html from out/renderer/
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 7. Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked and no windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', async () => {
  await stopBackendServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');

let winControl = null;
let winOverlay = null;
let isShuttingDown = false;

const debounce = (fn, ms = 150) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const HEIGHT_BUFFER = 4;

async function fitControlToContent () {
  if (!winControl || winControl.isDestroyed()) return;
  const [w] = winControl.getContentSize();
  const h = Math.ceil(
    await winControl.webContents.executeJavaScript(`
      (function () {
        const app = document.getElementById('app');
        const base = app
          ? app.getBoundingClientRect().height
          : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        return base;
      })();
    `)
  );
  const newH = h + HEIGHT_BUFFER;
  winControl.setContentSize(w, newH);
  winControl.setMinimumSize(w, newH);
  winControl.setMaximumSize(w, newH);
}

const fitControlToContentDebounced = debounce(fitControlToContent, 120);

function createWindows () {
  winOverlay = new BrowserWindow({
    width: 900,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  winOverlay.loadFile(path.join(__dirname, '..', 'overlay.html'));

  winControl = new BrowserWindow({
    width: 900,
    height: 180,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    title: 'Twitch Chat Counter — Control',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  winControl.loadFile(path.join(__dirname, '..', 'control.html'));

  winControl.webContents.on('did-finish-load', async () => {
    await fitControlToContent();
    winControl.on('will-resize', (e) => e.preventDefault());
  });

  winControl.on('move', fitControlToContentDebounced);
  winControl.on('resize', fitControlToContentDebounced);
  screen.on('display-metrics-changed', fitControlToContentDebounced);

  const closeAllAndQuit = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try { if (winControl && !winControl.isDestroyed()) winControl.close(); } catch {}
    try { if (winOverlay && !winOverlay.isDestroyed()) winOverlay.close(); } catch {}
    app.quit();
  };
  winControl.on('close', closeAllAndQuit);
  winOverlay.on('close', closeAllAndQuit);

  const forward = (channel) => {
    ipcMain.on(channel, (_evt, payload) => {
      if (winOverlay && !winOverlay.isDestroyed()) {
        winOverlay.webContents.send(channel, payload);
      }
    });
  };
  forward('connect');
  forward('disconnect');
  forward('reset');
  forward('update-terms');

  ipcMain.on('status', (_evt, payload) => {
    if (winControl && !winControl.isDestroyed()) {
      winControl.webContents.send('status', payload);
    }
  });

  const ok = globalShortcut.register('Control+Alt+R', () => {
    if (winOverlay && !winOverlay.isDestroyed()) {
      winOverlay.webContents.send('reset');
    }
  });
  if (!ok) console.warn('Не удалось зарегистрировать Ctrl+Alt+R');
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});

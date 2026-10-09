// Mindapp desktop — a thin native shell around the same web app.
// Files are served from inside the app over a private mindapp:// origin, so notes are
// stored on this computer (IndexedDB) and the app works fully offline.
const { app, BrowserWindow, protocol, net, shell, session, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, 'web');
const ORIGIN = 'mindapp://app';

protocol.registerSchemesAsPrivileged([
  { scheme: 'mindapp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 520,
    title: 'Mindapp',
    backgroundColor: '#f7f5ff',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(ORIGIN + '/index.html');

  // Anything that isn't the app itself (mailto:, web links) opens in your normal apps
  const external = (url) => !url.startsWith(ORIGIN + '/') && !url.startsWith('blob:') && !url.startsWith('data:');
  win.webContents.setWindowOpenHandler(({ url }) => { if (external(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (external(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('mindapp', (req) => {
    const { pathname } = new URL(req.url);
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // microphone (for future native voice) and clipboard; nothing else
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission));
  });

  // Standard menus give the usual shortcuts (⌘C/⌘V/⌘Z, Edit → Start Dictation on Mac)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

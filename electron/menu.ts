import { Menu, BrowserWindow, app } from 'electron'

/**
 * Build and set the application menu for macOS.
 * Cmd+* shortcuts use Electron accelerators for native feel.
 * Bare keys (Z, T, A, Space) are rendered as labels only — handled in renderer.
 */
export function buildApplicationMenu(getMainWindow: () => BrowserWindow | null) {
  const sendMenuAction = (action: string) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu-action', action);
    }
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open'),
        },
        { type: 'separator' },
        {
          label: 'Export',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuAction('export'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuAction('undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => sendMenuAction('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Delete',
          accelerator: 'Backspace',
          click: () => sendMenuAction('delete'),
        },
        { type: 'separator' },
        // Bare key shortcuts shown as labels only (no accelerators to avoid double-fire)
        {
          label: 'Add Zoom        Z',
          enabled: true,
          click: () => sendMenuAction('add-zoom'),
        },
        {
          label: 'Add Trim          T',
          enabled: true,
          click: () => sendMenuAction('add-trim'),
        },
        {
          label: 'Add Annotation  A',
          enabled: true,
          click: () => sendMenuAction('add-annotation'),
        },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play / Pause',
          // No accelerator for Space — handled in renderer to avoid double-fire
          click: () => sendMenuAction('toggle-play'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

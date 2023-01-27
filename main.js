const { app, BrowserWindow, Menu, MenuItem, shell } = require('electron')
const path = require('path')
const { find } = require('lodash');
const storage = require('electron-json-storage');
const { autoUpdater } = require("electron-updater");

let mainWindow;
let userInfo = {};
const appDomain = 'crowdin.com';

function createWindow () {
  mainWindow = new BrowserWindow({
    show: false,
    icon: path.join(__dirname, 'icons/128x128.png'),
    webPreferences: {
      devTools: false,
    },
  });

  if (process.platform === 'darwin') {
    buildMenu();
  } else {
    mainWindow.removeMenu();
  }
  mainWindow.maximize();
  mainWindow.show();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('context-menu', (_, props) => {
    const menu = new Menu();
    if (props.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      menu.popup();
    } else if (props.selectionText && props.selectionText.length) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.popup();
    }
  });

  let prevRedirectUrl = '';

  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (prevWillNavigateUrl.includes('accounts.') && prevWillNavigateUrl.includes('/authorize/')) {
      e.preventDefault();
      openSsoWindow(url);
      prevRedirectUrl = url;
      return;
    }

    if (prevRedirectUrl.includes('jwt/set')) {
      saveUserInfo(url);
      e.preventDefault();
      openEditor();
      prevRedirectUrl = url;
      return;
    }
    prevRedirectUrl = url;
  });

  mainWindow.webContents.on('did-navigate', (e, url) => {
    if (url.includes('logout')) {
      clearUserInfo();
      return;
    }

    if (isEditorUrl(url)) {
      saveUserInfo(url);
    }
  });

  let prevWillNavigateUrl = '';

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url === 'https://crowdin.com' || url === 'https://crowdin.com/') {
      e.preventDefault();
      return;
    }

    if (url.includes('cloudflare')) {
      e.preventDefault();
      shell.openExternal(url);
      return;
    }

    if (prevWillNavigateUrl.includes('/logout') && !isEditorUrl(url) && !url.includes('accounts.')) {
      e.preventDefault();
      prevWillNavigateUrl = url;
      mainWindow.loadURL(`https://accounts.${appDomain}`);
      return;
    }
    prevWillNavigateUrl = url;
  });

  mainWindow.webContents.on('did-navigate-in-page', (e, url) => {
    if (isEditorUrl(url)) {
      saveUserInfo(url);
    }
  });

  loadUserInfo();

  const hiddenWindow = new BrowserWindow({ width: 1, height: 1, show: false });

  hiddenWindow.loadURL(`https://accounts.${appDomain}`)
    .then(() => {
      hiddenWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.workspace-list a.btn-link')).map(node => node.href)`).then(function (result) {
        const { domain } = getUserInfo();
        let foundLoginForSavedDomain = false;
        const loginTo = find(result, url => {
          if (domain) {
            if (url.includes(`?domain=${domain}`)) {
              foundLoginForSavedDomain = true;
            }
            return url.includes(`?domain=${domain}`);
          }

          if (!url.includes(`?domain=`) && !domain) {
            foundLoginForSavedDomain = true;
          }

          return !url.includes('?domain=');
        });

        if (loginTo && foundLoginForSavedDomain) {
          openEditor();
          hiddenWindow.close();
        } else {
          mainWindow.loadURL(`https://accounts.${appDomain}`).then(() => {
            hiddenWindow.close();
          });
        }
      }).catch(e => {
        console.log(e);
        hiddenWindow.close();
      });
    }).catch(e => {
      console.log(e);
      hiddenWindow.close();
     });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  });
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

function saveUserInfo(url) {
  const parsedUrl = new URL(url);
  const data = {
    domain: parsedUrl.host.replace(appDomain,'').replace('.', ''),
    lastProjectUrl: isEditorUrl(url) ? `${parsedUrl.pathname}${parsedUrl.search}` : null,
  };
  storage.set('user-data', data);
  userInfo = data;
}

function openSsoWindow(url) {
  const ssoWindow = new BrowserWindow({
    parent: mainWindow,
  });
  ssoWindow.loadURL(url);

  let ssoWindowPrevRedirectUrl = '';
  ssoWindow.webContents.on('will-redirect', (e, url) => {
    if (ssoWindowPrevRedirectUrl.includes('jwt/set')) {
      saveUserInfo(url);
      e.preventDefault();
      openEditor();
      ssoWindow.close();
    }
    ssoWindowPrevRedirectUrl = url;
  });

  ssoWindow.on('close', () => {
    mainWindow.webContents.executeJavaScript("$('.loadmask, .loadmask-msg').remove()");
  })
}

function openEditor() {
  const { lastProjectUrl, domain } = getUserInfo();

  if (lastProjectUrl) {
    mainWindow.loadURL(getRedirectUrl());
  } else {
    const editorUrl = `https://${!!domain ? domain + '.' : ''}${appDomain}/multilingual?em`;
    mainWindow.loadURL(editorUrl);
  }
}

function getRedirectUrl() {
  const { domain, lastProjectUrl } = getUserInfo();
  return `https://${domain ? domain + '.' : ''}${appDomain}${lastProjectUrl}`;
}

function clearUserInfo() {
  userInfo = {};
  storage.set('user-data', {});
}

function isEditorUrl(url) {
  return ['translate', 'proofread', 'asset', 'multilingual', 'review'].some(editorPath => {
    return url.includes(`${appDomain}/${editorPath}`);
  });
}

function loadUserInfo() {
  storage.get('user-data', (e, data = {}) => {
    if (e) {
      userInfo = {};
      return;
    }

    userInfo = data;
  })
}

function getUserInfo() {
  return userInfo;
}

function buildMenu() {
  const template = [
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
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { role: 'close' },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ]
    },
    {
      label: 'View',
      submenu: [
        /* { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }, */
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' },
      ]
    },
  ];

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Modules to control application life and create native browser window
const {app, BrowserWindow} = require('electron')
const path = require('path')
const { find } = require('lodash');
const storage = require('electron-json-storage');
const fetch = require('node-fetch');

let mainWindow;
let userInfo = {};

function createWindow () {
  // Create the browser window.
  // TODO: show preloader?
  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'logo.ico')
  });

  mainWindow.maximize();
  mainWindow.show();

  let prevRedirectUrl = '';

  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (prevRedirectUrl.includes('jwt/set')) {
      e.preventDefault();
      openProject();
      prevRedirectUrl = url;
      return;
    }
    prevRedirectUrl = url;
  });

  mainWindow.webContents.on('did-navigate', (e, url) => {
    if (url.includes('logout')) {
      console.log('logour done. clear');
      e.preventDefault();
      clearUserInfo();
      mainWindow.loadURL('https://accounts.crowdin.com');
      return;
    }

    if (isEditorUrl(url)) {
      saveUserInfo(url);
    }
  });

  mainWindow.webContents.on('did-navigate-in-page', (e, url) => {
    console.log('did redirect', url);
    if (isEditorUrl(url)) {
      saveUserInfo(url);
    }
  });

  loadUserInfo();

  const hiddenWindow = new BrowserWindow({ width: 1, height: 1, show: false });

  hiddenWindow.loadURL('https://accounts.crowdin.com')
    .then(() => {
      hiddenWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.workspace-list a.btn-link')).map(node => node.href)`).then(function (result) {
        const { domain } = getUserInfo();
        const loginTo = find(result, url => {
          if (domain) {
            return url.includes(`?domain=${domain}`);
          }

          return !url.includes('?domain=');
        });

        if (loginTo) {
          openProject();
        } else {
          mainWindow.loadURL('https://accounts.crowdin.com').then(() => {
            hiddenWindow.close();
          });
        }
      }).catch(e => {
        console.log('e1', e);
      });
    }).catch(e => {
      console.log('e2', e);
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
function saveUserInfo(url) {
  const parsedUrl = new URL(url);
  // TODO: add encryption?
  storage.set('user-data', {
    domain: parsedUrl.host.replace('crowdin.com',''),
    lastProjectUrl: parsedUrl.pathname,
  })
}

function openProject() {
  const { lastProjectUrl } = getUserInfo();
  if (lastProjectUrl) {
    mainWindow.loadURL(getRedirectUrl());
  } else {
    console.log('no proect');
    // TODO: shomehow get project url or open editor to select project
    mainWindow.webContents.session.cookies.get({})
      .then(cookies => {
        const csrfToken = find(cookies, c => c.name = 'csrf_token').value;
        console.log('csrfToken', csrfToken);
        const cookiesString = cookies.map(c => {
          return c.name + '=' + c.value;
        }).join('; ');
        console.log('cookiesString', cookiesString);
        fetch("https://crowdin.com/backend/profile_actions/get_user_projects", {
          "headers": {
            "accept": "*/*",
            "accept-language": "uk,uk-UA;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6,fr;q=0.5,he;q=0.4",
            "sec-ch-ua": "\".Not/A)Brand\";v=\"99\", \"Google Chrome\";v=\"103\", \"Chromium\";v=\"103\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Linux\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-csrf-token": csrfToken,
            "x-requested-with": "XMLHttpRequest",
            "cookie": cookiesString,
            "Referer": "https://crowdin.com/profile",
            "Referrer-Policy": "origin-when-cross-origin"
          },
          "body": null,
          "method": "GET"
        }).then(r => r.json()).then(r => {
          // console.log('r', r);
          if (!r.projects.length) {
            // TODO: do something??
          }
          const project = r.projects[0];
          // const link = 'https://crowdin.com/translate/' + project.identifier + '/all?em';
          const link = 'https://crowdin.com/translate/' + project.identifier + '/all';
          mainWindow.loadURL(link);
        });
      });
  }
}

function getRedirectUrl() {
  const { domain, lastProjectUrl } = getUserInfo();

  console.log('lastProjectUrl', lastProjectUrl);

  return `https://${domain ? domain + '.' : ''}crowdin.com${lastProjectUrl}`;
}

function clearUserInfo() {
  userInfo = {};
  storage.set('user-data', {});
}

function isEditorUrl(url) {
  return ['translate', 'proofread', 'asset'].some(editorPath => {
    return url.includes(`crowdin.com/${editorPath}`);
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
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
    autoHideMenuBar: true,
    webPreferences: {
      // nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon/logo.ico')
  });

  mainWindow.maximize();
  mainWindow.show();

  let prevRedirectUrl = '';

  mainWindow.webContents.on('will-redirect', (e, url) => {
    if (prevRedirectUrl.includes('jwt/set')) {
      saveUserInfo(url);
      e.preventDefault();
      openProject();
      prevRedirectUrl = url;
      return;
    }
    prevRedirectUrl = url;
  });

  mainWindow.webContents.on('did-navigate', (e, url) => {
    if (url.includes('logout')) {
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
        let foundLoginForSavedDomain = false;
        const loginTo = find(result, url => {
          if (domain) {
            foundLoginForSavedDomain = true;
            return url.includes(`?domain=${domain}`);
          }

          return !url.includes('?domain=');
        });

        if (loginTo && foundLoginForSavedDomain) {
          openProject();
        } else {
          mainWindow.loadURL('https://accounts.crowdin.com').then(() => {
            hiddenWindow.close();
          });
        }
      }).catch(e => {
        console.log(e);
      });
    }).catch(e => {
      console.log(e);
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
  const data = {
    domain: parsedUrl.host.replace('crowdin.com','').replace('.', ''),
    lastProjectUrl: isEditorUrl(url) ? parsedUrl.pathname : null,
  };
  // TODO: add encryption?
  storage.set('user-data', data);
  userInfo = data;
}

function getFetchOptions(csrfToken, cookiesString, domain) {
  return {
    "headers": {
      "accept": "*/*",
      "accept-language": "uk,uk-UA;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6,fr;q=0.5,he;q=0.4",
      "pragma": "no-cache",
      "sec-ch-ua": "\".Not/A)Brand\";v=\"99\", \"Google Chrome\";v=\"103\", \"Chromium\";v=\"103\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Linux\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": csrfToken,
      "x-requested-with": "XMLHttpRequest",
      "cookie": cookiesString,
      "Referer": domain ? `https://${domain}.crowdin.com/u` : "https://crowdin.com/profile",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    },
    "body": null,
    "method": "GET"
  };
}

function loadEnterpriseProject(domain, csrfToken, cookiesString) {
  const baseUrl = `https://${domain}.crowdin.com/backend/`;
  const fetchOptions = getFetchOptions(csrfToken, cookiesString, domain);
  fetch(baseUrl + 'app/init', fetchOptions)
    .then(r => r.json())
    .then(r => {
      return fetch(baseUrl + 'projects/list?group_id=' + r.data.root_group.id, fetchOptions).then(r => r.json());
    })
    .then(r => {
      const project = r.data.projects[0];
      let link = `https://${domain}.crowdin.com/translate/${project.identifier}/all`;
      mainWindow.loadURL(link);
    })
    .catch(e => {
      showOffline();
    });
}

function loadCrowdinProject(csrfToken, cookiesString) {
  const options = getFetchOptions(csrfToken, cookiesString);
  fetch("https://crowdin.com/backend/profile_actions/get_user_projects", options).then(r => r.json()).then(r => {
    // TODO: replace with project selection page
    let link = 'https://crowdin.com/profile';
    if (r && r.projects.length) {
      const project = r.projects[0];
      // TODO: ?em
      link = 'https://crowdin.com/translate/' + project.identifier + '/all';
    }
    mainWindow.loadURL(link);
  }).catch(e => showOffline());
}

function showOffline() {
  // TODO: show offline page
}

function openProject() {
  const { lastProjectUrl, domain } = getUserInfo();
  // TODO: check if url is fo current user (store userId) and organization
  if (lastProjectUrl) {
    mainWindow.loadURL(getRedirectUrl());
  } else {
    const cookieDomain = 'https://' + (!domain || domain === '' ? 'crowdin.com' : domain + '.crowdin.com');
    const hiddenWindow = new BrowserWindow({ width: 1, height: 1, show: false });
    // load window to load cookies
    hiddenWindow.loadURL(cookieDomain)
      .then(() => {
        setTimeout(() => {
          mainWindow.webContents.session.cookies.get({ url: cookieDomain })
            .then(cookies => {
              const csrfToken = find(cookies, c => c.name === 'csrf_token').value;
              const cookiesString = cookies.map(c => {
                return c.name + '=' + c.value;
              }).join('; ');

              hiddenWindow.close();

              if (!domain) {
                loadCrowdinProject(csrfToken, cookiesString);
              } else {
                loadEnterpriseProject(domain, csrfToken, cookiesString);
              }
            });
        }, 500);
      });
  }
}

function getRedirectUrl() {
  const { domain, lastProjectUrl } = getUserInfo();

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

    // TODO: properly implement this
    // userInfo = data;
    userInfo = {};
  })
}

function getUserInfo() {
  return userInfo;
}
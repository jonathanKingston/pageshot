/* globals chrome, console, XMLHttpRequest, Image, document, setTimeout, makeUuid */
let hasUsedMyShots = false;
let backend = "https://pageshot.dev.mozaws.net";
let registrationInfo;
let initialized = false;
const STORAGE_LIMIT = 100;
const TIME_LIMIT = 1000 * 60 * 60 * 24 * 30; // 30 days


chrome.runtime.onInstalled.addListener(function () {

});

chrome.browserAction.onClicked.addListener(function(tab) {
  chrome.tabs.insertCSS({
    file: "css/inline-selection.css"
  });
  let scripts = [
    "error-utils.js",
    "uuid.js",
    "shared/shot.js",
    "randomstring.js",
    "url-domain.js",
    "add-ids.js",
    "make-static-html.js",
    "extractor-worker.js",
    "annotate-position.js",
    "selector-util.js",
    "selector-ui.js",
    "selector-snapping.js",
    "shooter-interactive-worker.js",
    "chrome-shooter.js"
  ];
  let lastPromise = Promise.resolve(null);
  scripts.forEach((script) => {
    lastPromise = lastPromise.then(() => {
      return chrome.tabs.executeScript({
        file: script
      });
    });
  });
  lastPromise.then(() => {
    console.log("finished loading scripts:", scripts, chrome.runtime.lastError);
  });
});

chrome.storage.sync.get(["backend", "hasUsedMyShots", "registrationInfo"], (result) => {
  if (result.backend) {
    backend = result.backend;
  }
  if (result.hasUsedMyShots) {
    hasUsedMyShots = true;
  }
  if (result.registrationInfo) {
    registrationInfo = result.registrationInfo;
    login();
  } else {
    registrationInfo = generateRegistrationInfo();
    chrome.storage.sync.set({
      registrationInfo: registrationInfo
    }, () => {
      console.info("Device authentication saved");
    });
    console.info("Generating new device authentication ID", registrationInfo);
    register();
  }
});

function generateRegistrationInfo() {
  let info = {
    deviceId: "anon" + makeUuid() + "",
    secret: makeUuid()+"",
    // FIXME-chrome: need to figure out the reason the extension was created
    // (i.e., startup or install)
    //reason,
    deviceInfo: JSON.stringify(deviceInfo())
  };
  return info;
}

function deviceInfo() {
  // FIXME: can use chrome.runtime.getManifest() to get some of this metadata
  return {
    //addonVersion: self.version,
    //platform: system.platform,
    //architecture: system.architecture,
    //version: system.version,
    //build: system.build,
    //platformVersion: system.platformVersion,
    //appVendor: system.vendor,
    appName: "chrome"
  };
}

function login() {
  return new Promise((resolve, reject) => {
    let loginUrl = backend + "/api/login";
    let req = new XMLHttpRequest();
    req.open("POST", loginUrl);
    req.onload = () => {
      if (req.status == 404) {
        // No such user
        resolve(login());
      } else if (req.status >= 300) {
        console.warn("Error in response:", req.responseText);
        reject(new Error("Could not log in: " + req.status));
      } else if (req.status === 0) {
        let error = new Error("Could not log in, server unavailable");
        reject(error);
      } else {
        initialized = true;
        console.info("logged in");
        resolve();
      }
    };
    req.setRequestHeader("content-type", "application/x-www-form-urlencoded");
    req.send(uriEncode({
      deviceId: registrationInfo.deviceId,
      secret: registrationInfo.secret,
      // FIXME: give proper reason
      reason: "install",
      deviceInfo: JSON.stringify(deviceInfo())
    }));
  });
}

function register() {
  return new Promise((resolve, reject) => {
    let registerUrl = backend + "/api/register";
    let req = new XMLHttpRequest();
    req.open("POST", registerUrl);
    req.setRequestHeader("content-type", "application/x-www-form-urlencoded");
    req.onload = () => {
      if (req.status == 200) {
        console.info("Registered login");
        initialized = true;
        resolve();
      } else {
        console.warn("Error in response:", req.responseText);
        reject(new Error("Bad response: " + req.status));
      }
    };
    req.send(uriEncode(registrationInfo));
  });
}

function uriEncode(obj) {
  let s = [];
  for (let key in obj) {
    s.push(`${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`);
  }
  return s.join("&");
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  console.log("got request", req, sender);
  if (req.type == "requestConfiguration") {
    sendResponse({
      backend,
      hasUsedMyShots,
      deviceId: registrationInfo.deviceId,
      deviceInfo: registrationInfo.deviceInfo,
      secret: registrationInfo.secret
    });
    console.log("sent response", {config: {backend, hasUsedMyShots, registrationInfo}});
  } else if (req.type == "clipImage") {
    screenshotPage(
      req.pos,
      {
        scrollX: req.scrollX,
        scrollY: req.scrollY,
        innerHeight: req.innerHeight,
        innerWidth: req.innerWidth
      }
    ).then((imageUrl) => {
      sendResponse({imageUrl});
    });
    // Indicates async sendResponse:
    return true;
  } else if (req.type == "saveShotFullPage") {
    saveShotFullPage(req.id, req.shot);
    sendResponse(true);
  } else if (req.type == "has-saved-shot") {
    hasSavedShot(req.id).then((result) => {
      sendResponse(result);
    });
    return true;
  } else if (req.type == "request-saved-shot") {
    getSavedShot(req.id).then((result) => {
      sendResponse(result);
    });
    return true;
  } else if (req.type == "remove-saved-shot") {
    removeSavedShot(req.id).then(() => {
      sendResponse(null);
    });
    return true;
  } else {
    console.error("Message not understood:", req);
  }
  return undefined;
});

function screenshotPage(pos, scroll) {
  pos = {
    top: pos.top - scroll.scrollY,
    left: pos.left - scroll.scrollX,
    bottom: pos.bottom - scroll.scrollY,
    right: pos.right - scroll.scrollX
  };
  pos.width = pos.right - pos.left;
  pos.height = pos.bottom - pos.top;
  return new Promise((resolve, reject) => {
    return chrome.tabs.captureVisibleTab(
      null,
      {format: "png"},
      function (dataUrl) {
        let image = new Image();
        image.src = dataUrl;
        image.onload = () => {
          let xScale = image.width / scroll.innerWidth;
          let yScale = image.height / scroll.innerHeight;
          let canvas = document.createElement("canvas");
          canvas.height = pos.height * yScale;
          canvas.width = pos.width * xScale;
          let context = canvas.getContext("2d");
          context.drawImage(
            image,
            pos.left * xScale, pos.top * yScale,
            pos.width * xScale, pos.height * yScale,
            0, 0,
            pos.width * xScale, pos.height * yScale
          );
          let result = canvas.toDataURL();
          resolve(result);
        };
      }
    );
  });
}

function saveShotFullPage(id, shot) {
  // Note: duplicates/similar to shotstore.saveShot
  let name = "page-" + id;
  chrome.storage.local.get(name, (result) => {
    console.log("saveshotfullpage", id, name, shot, result);
    let data = result[name] || {};
    let newData = {
      body: shot.body || data.body,
      head: shot.head || data.head,
      bodyAttrs: shot.bodyAttrs || data.bodyAttrs,
      headAttrs: shot.headAttrs || data.headAttrs,
      htmlAttrs: shot.htmlAttrs || data.htmlAttrs,
      created: Date.now(),
      readable: shot.readable,
      resources: shot.resources
    };
    chrome.storage.local.set({[name]: newData});
    setTimeout(cleanupShots, 0);
  });
}

function cleanupShots() {
  // Note: duplications/similar to shotstore.cleanupShots
  chrome.storage.local.get(null, (storage) => {
    let keyDates = [];
    let now = Date.now();
    let toDelete = [];
    for (let key in storage) {
      if (! key.startsWith("page-")) {
        continue;
      }
      let created = storage[key].created || 0;
      if (! created || created + TIME_LIMIT < now) {
        toDelete.push(key);
      } else {
        keyDates.push({key, created});
      }
    }
    for (let key of toDelete) {
      console.log("delete by date", key);
    }
    console.log("checking items", keyDates.length, STORAGE_LIMIT);
    if (keyDates.length > STORAGE_LIMIT) {
      keyDates.sort(function (a, b) {
        return a.created < b.created ? -1 : 1;
      });
      while (keyDates.length > STORAGE_LIMIT) {
        let {key} = keyDates.shift();
        console.log("delete by limit", key);
        toDelete.push(key);
      }
    }
    if (toDelete.length) {
      chrome.storage.local.remove(toDelete);
    }
  });
}

function getSavedShot(id) {
  return new Promise((resolve, reject) => {
    let name = "page-" + id;
    chrome.storage.local.get(name, (result) => {
      console.log("getSavedShot", id, Object.keys(result));
      resolve(result[name]);
    });
  });
}

function hasSavedShot(id) {
  return getSavedShot(id).then((shot) => {
    return !!shot;
  });
}

function removeSavedShot(id) {
  return new Promise((resolve, reject) => {
    let name = "page-" + id;
    chrome.storage.local.remove(name, () => {
      resolve();
    });
  });
}

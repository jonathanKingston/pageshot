/* globals chrome, console, XMLHttpRequest, Image, document, setTimeout, navigator */
/* globals loadSelector, analytics, communication, catcher */
window.main = (function () {
  let exports = {};

  const { sendEvent } = analytics;

  let manifest = chrome.runtime.getManifest();
  let backend;

  exports.setBackend = function (newBackend) {
    backend = newBackend;
    backend = backend.replace(/\/*$/, "");
  };

  exports.getBackend = function () {
    return backend;
  };

  for (let permission of manifest.permissions) {
    if (permission.search(/^https?:\/\//i) != -1) {
      exports.setBackend(permission);
      break;
    }
  }

  chrome.runtime.onInstalled.addListener(function () {
  });

  chrome.browserAction.onClicked.addListener(function(tab) {
    sendEvent("start-shot", "toolbar-pageshot-button");
    catcher.watchPromise(loadSelector());
  });

  chrome.contextMenus.create({
    id: "create-pageshot",
    title: "Create Page Shot",
    contexts: ["page"]
  }, () => {
    if (chrome.runtime.lastError) {
      catcher.unhandled(new Error(chrome.runtime.lastError.message));
    }
  });

  chrome.contextMenus.onClicked.addListener(catcher.watchFunction((info, tab) => {
    if (! tab) {
      // Not in a page/tab context, ignore
      return;
    }
    sendEvent("start-shot", "context-menu");
    catcher.watchPromise(loadSelector());
  }));


  communication.register("sendEvent", (...args) => {
    catcher.watchPromise(sendEvent(...args));
    // We don't wait for it to complete:
    return null;
  });

  communication.register("openMyShots", () => {
    chrome.tabs.create({url: backend + "/shots"});
  });

  return exports;
})();

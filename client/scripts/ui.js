const $ = (query) => document.getElementById(query);
const $$ = (query) => document.body.querySelector(query);
const isURL = (text) => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported =
  typeof document.createElement("a").download !== "undefined";
window.isProductionEnvironment = !window.location.host.startsWith("localhost");
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// set display name
Events.on("display-name", (e) => {
  const me = e.detail.message;
  const $displayName = $("displayName");
  $displayName.textContent = "You are known as " + me.displayName;
  $displayName.title = me.deviceName;
});

class PeersUI {
  constructor() {
    Events.on("peer-joined", (e) => this._onPeerJoined(e.detail));
    Events.on("peer-left", (e) => this._onPeerLeft(e.detail));
    Events.on("peers", (e) => this._onPeers(e.detail));
    Events.on("file-progress", (e) => this._onFileProgress(e.detail));
    Events.on("paste", (e) => this._onPaste(e));
  }

  _onPeerJoined(peer) {
    if ($(peer.id)) return;
    document.body.classList.add("transitioning");
    const peerUI = new PeerUI(peer);
    $$("x-peers").appendChild(peerUI.$el);
    setTimeout((e) => window.animateBackground(false), 1750);
    setTimeout(() => document.body.classList.remove("transitioning"), 400);
  }

  _onPeers(peers) {
    this._clearPeers();
    peers.forEach((peer) => this._onPeerJoined(peer));
  }

  _onPeerLeft(peerId) {
    const $peer = $(peerId);
    if (!$peer) return;
    document.body.classList.add("transitioning");
    $peer.setAttribute("leaving", 1);
    setTimeout(() => {
        $peer.remove();
        document.body.classList.remove("transitioning");
    }, 200);
  }

  _onFileProgress(progress) {
    const peerId = progress.sender || progress.recipient;
    const $peer = $(peerId);
    if (!$peer) return;
    $peer.ui.setProgress(progress.progress);
  }

  _clearPeers() {
    const $peers = ($$("x-peers").innerHTML = "");
  }

  _onPaste(e) {
    const files =
      e.clipboardData.files ||
      e.clipboardData.items
        .filter((i) => i.type.indexOf("image") > -1)
        .map((i) => i.getAsFile());
    const peers = document.querySelectorAll("x-peer");
    if (files.length > 0 && peers.length === 1) {
      Events.fire("files-selected", {
        files: files,
        to: $$("x-peer").id,
      });
    }
  }
}

class PeerUI {
  html() {
    return `
            <label class="column center" title="Click to send files or right click to send a text">
                <input type="file" multiple>
                <x-icon shadow="1">
                    <svg class="icon"><use xlink:href="#"/></svg>
                </x-icon>
                <div class="progress">
                  <div class="circle"></div>
                  <div class="circle right"></div>
                </div>
                <div class="name font-subheading"></div>
                <div class="device-name font-body2"></div>
                <div class="status font-body2"></div>
            </label>`;
  }

  constructor(peer) {
    this._peer = peer;
    this._initDom();
    this._bindListeners(this.$el);
  }

  _initDom() {
    const el = document.createElement("x-peer");
    el.id = this._peer.id;
    el.innerHTML = this.html();
    el.ui = this;
    el.querySelector("svg use").setAttribute("xlink:href", this._icon());
    el.querySelector(".name").textContent = this._displayName();
    el.querySelector(".device-name").textContent = this._deviceName();
    this.$el = el;
    this.$progress = el.querySelector(".progress");
  }

  _bindListeners(el) {
    el.querySelector("input").addEventListener("change", (e) =>
      this._onFilesSelected(e),
    );
    el.addEventListener("drop", (e) => this._onDrop(e));
    el.addEventListener("dragend", (e) => this._onDragEnd(e));
    el.addEventListener("dragleave", (e) => this._onDragEnd(e));
    el.addEventListener("dragover", (e) => this._onDragOver(e));
    el.addEventListener("contextmenu", (e) => this._onRightClick(e));
    el.addEventListener("touchstart", (e) => this._onTouchStart(e));
    el.addEventListener("touchend", (e) => this._onTouchEnd(e));
    Events.on("dragover", (e) => e.preventDefault());
    Events.on("drop", (e) => e.preventDefault());
  }

  _displayName() {
    return this._peer.name.displayName;
  }

  _deviceName() {
    return this._peer.name.deviceName;
  }

  _icon() {
    const device = this._peer.name.device || this._peer.name;
    if (device.type === "mobile") return "#phone-iphone";
    if (device.type === "tablet") return "#tablet-mac";
    return "#desktop-mac";
  }

  _onFilesSelected(e) {
    const $input = e.target;
    const files = $input.files;
    Events.fire("files-selected", { files: files, to: this._peer.id });
    $input.value = null;
  }

  setProgress(progress) {
    if (progress > 0) {
      this.$el.setAttribute("transfer", "1");
    }
    if (progress > 0.5) {
      this.$progress.classList.add("over50");
    } else {
      this.$progress.classList.remove("over50");
    }
    const degrees = `rotate(${360 * progress}deg)`;
    this.$progress.style.setProperty("--progress", degrees);
    if (progress >= 1) {
      this.setProgress(0);
      this.$el.removeAttribute("transfer");
    }
  }

  _onDrop(e) {
    e.preventDefault();
    const files = e.dataTransfer.files;
    Events.fire("files-selected", { files: files, to: this._peer.id });
    this._onDragEnd();
  }

  _onDragOver() {
    this.$el.setAttribute("drop", 1);
  }

  _onDragEnd() {
    this.$el.removeAttribute("drop");
  }

  _onRightClick(e) {
    e.preventDefault();
    Events.fire("text-recipient", this._peer.id);
  }

  _onTouchStart(e) {
    this._touchStart = Date.now();
    this._touchTimer = setTimeout((_) => this._onTouchEnd(), 610);
  }

  _onTouchEnd(e) {
    if (Date.now() - this._touchStart < 500) {
      clearTimeout(this._touchTimer);
    } else {
      if (e) e.preventDefault();
      Events.fire("text-recipient", this._peer.id);
    }
  }
}

class Dialog {
  constructor(id) {
    this.$el = $(id);
    this.$el
      .querySelectorAll("[close]")
      .forEach((el) => el.addEventListener("click", (e) => this.hide()));
    this.$autoFocus = this.$el.querySelector("[autofocus]");
  }

  show() {
    document.body.classList.add("transitioning");
    this.$el.setAttribute("show", 1);
    if (this.$autoFocus) this.$autoFocus.focus();
    setTimeout(() => document.body.classList.remove("transitioning"), 280);
  }

  hide() {
    document.body.classList.add("transitioning");
    this.$el.removeAttribute("show");
    document.activeElement.blur();
    window.blur();
    setTimeout(() => document.body.classList.remove("transitioning"), 200);
  }
}

class ReceiveDialog extends Dialog {
  constructor() {
    super("receiveDialog");
    Events.on("file-received", (e) => {
      this._nextFile(e.detail);
      window.blop.play();
    });
    this._pendingFiles = [];
    this._bundleTimer = null;
  }

  _nextFile(nextFile) {
    if (nextFile) {
      this._pendingFiles.push(nextFile);
      if (this._pendingFiles.length === 1) {
        Events.fire("notify-user", "Receiving files...");
      }
    }

    if (this._busy) return;

    clearTimeout(this._bundleTimer);
    this._bundleTimer = setTimeout(() => this._bundleAndDownload(), 1500);
  }

  async _bundleAndDownload() {
    const files = [...this._pendingFiles];
    this._pendingFiles = [];
    if (files.length === 0) return;

    if (files.length === 1) {
      this._busy = true;
      this._displayFile(files[0]);
    } else {
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f.blob));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const name = "VelvetDrop-" + Date.now() + ".zip";

      const $a = document.createElement("a");
      $a.href = url;
      $a.download = name;
      $a.click();

      Events.fire("notify-user", `${files.length} files saved as ZIP`);
    }
  }

  _dequeueFile() {
    if (!this._pendingFiles.length) {
      this._busy = false;
      return;
    }
    setTimeout((_) => {
      this._busy = false;
      this._nextFile();
    }, 300);
  }

  _displayFile(file) {
    const $a = this.$el.querySelector("#download");
    const url = URL.createObjectURL(file.blob);
    $a.href = url;
    $a.download = file.name;

    if (this._autoDownload()) {
      $a.click();
      return;
    }
    if (file.mime.split("/")[0] === "image") {
      this.$el.querySelector(".preview").style.visibility = "inherit";
      this.$el.querySelector("#img-preview").src = url;
    }

    this.$el.querySelector("#fileName").textContent = file.name;
    this.$el.querySelector("#fileSize").textContent = this._formatFileSize(file.size);
    this.show();

    if (window.isDownloadSupported) return;
    $a.target = "_blank";
    const reader = new FileReader();
    reader.onload = (e) => ($a.href = reader.result);
    reader.readAsDataURL(file.blob);
  }

  _formatFileSize(bytes) {
    if (bytes >= 1e9) return Math.round(bytes / 1e8) / 10 + " GB";
    else if (bytes >= 1e6) return Math.round(bytes / 1e5) / 10 + " MB";
    else if (bytes > 1000) return Math.round(bytes / 1000) + " KB";
    else return bytes + " Bytes";
  }

  hide() {
    this.$el.querySelector(".preview").style.visibility = "hidden";
    this.$el.querySelector("#img-preview").src = "";
    super.hide();
    this._dequeueFile();
  }

  _autoDownload() {
    return !this.$el.querySelector("#autoDownload").checked;
  }
}

class SendTextDialog extends Dialog {
  constructor() {
    super("sendTextDialog");
    Events.on("text-recipient", (e) => this._onRecipient(e.detail));
    this.$text = this.$el.querySelector("#textInput");
    const button = this.$el.querySelector("form");
    button.addEventListener("submit", (e) => this._send(e));
  }

  _onRecipient(recipient) {
    this._recipient = recipient;
    this._handleShareTargetText();
    this.show();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(this.$text);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _handleShareTargetText() {
    if (!window.shareTargetText) return;
    this.$text.textContent = window.shareTargetText;
    window.shareTargetText = "";
  }

  _send(e) {
    e.preventDefault();
    Events.fire("send-text", { to: this._recipient, text: this.$text.innerText });
  }
}

class ReceiveTextDialog extends Dialog {
  constructor() {
    super("receiveTextDialog");
    Events.on("text-received", (e) => this._onText(e.detail));
    this.$text = this.$el.querySelector("#text");
    const $copy = this.$el.querySelector("#copy");
    $copy.addEventListener("click", (_) => this._onCopy());
  }

  _onText(e) {
    this.$text.innerHTML = "";
    const text = e.text;
    if (isURL(text)) {
      const $a = document.createElement("a");
      $a.href = text;
      $a.target = "_blank";
      $a.textContent = text;
      this.$text.appendChild($a);
    } else {
      this.$text.textContent = text;
    }
    this.show();
    window.blop.play();
  }

  async _onCopy() {
    await navigator.clipboard.writeText(this.$text.textContent);
    Events.fire("notify-user", "Copied to clipboard");
  }
}

class Toast extends Dialog {
  constructor() {
    super("toast");
    Events.on("notify-user", (e) => this._onNotfiy(e.detail));
  }

  _onNotfiy(message) {
    this.$el.textContent = message;
    this.show();
    setTimeout((_) => this.hide(), 3000);
  }
}

class Notifications {
  constructor() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      this.$button = $("notification");
      this.$button.removeAttribute("hidden");
      this.$button.addEventListener("click", (e) => this._requestPermission());
    }
    Events.on("text-received", (e) => this._messageNotification(e.detail.text));
    Events.on("file-received", (e) => this._downloadNotification(e.detail.name));
  }

  _requestPermission() {
    Notification.requestPermission((permission) => {
      if (permission !== "granted") {
        Events.fire("notify-user", Notifications.PERMISSION_ERROR || "Error");
        return;
      }
      this._notify("Even more snappy sharing!");
      this.$button.setAttribute("hidden", 1);
    });
  }

  _notify(message, body) {
    const config = { body: body, icon: "images/android-chrome-192x192.png" };
    let notification;
    try {
      notification = new Notification(message, config);
    } catch (e) {
      if (!serviceWorker || !serviceWorker.showNotification) return;
      notification = serviceWorker.showNotification(message, config);
    }
    const visibilitychangeHandler = () => {
      if (document.visibilityState === "visible") {
        notification.close();
        Events.off("visibilitychange", visibilitychangeHandler);
      }
    };
    Events.on("visibilitychange", visibilitychangeHandler);
    return notification;
  }

  _messageNotification(message) {
    if (document.visibilityState !== "visible") {
      if (isURL(message)) {
        const notification = this._notify(message, "Click to open link");
        this._bind(notification, (e) => window.open(message, "_blank", null, true));
      } else {
        const notification = this._notify(message, "Click to copy text");
        this._bind(notification, (e) => this._copyText(message, notification));
      }
    }
  }

  _downloadNotification(message) {
    if (document.visibilityState !== "visible") {
      const notification = this._notify(message, "Click to download");
      if (!window.isDownloadSupported) return;
      this._bind(notification, (e) => this._download(notification));
    }
  }

  _download(notification) {
    document.querySelector("x-dialog [download]").click();
    notification.close();
  }

  _copyText(message, notification) {
    notification.close();
    if (!navigator.clipboard.writeText(message)) return;
    this._notify("Copied text to clipboard");
  }

  _bind(notification, handler) {
    if (notification.then) {
      notification.then((e) =>
        serviceWorker.getNotifications().then((notifications) => {
          serviceWorker.addEventListener("notificationclick", handler);
        }),
      );
    } else {
      notification.onclick = handler;
    }
  }
}

class RoomUI {
  constructor() {
    this._initRoom();
    this._renderRoomBar();
  }

  _initRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    let room = urlParams.get("room");

    if (!room) {
      room = this._generateCode(6);
      urlParams.set("room", room);
      const newUrl = window.location.pathname + "?" + urlParams.toString();
      window.history.replaceState({}, "", newUrl);
    }
    this.roomCode = room.toUpperCase();
  }

  _generateCode(length) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  _renderRoomBar() {
    const $bar = document.createElement("div");
    $bar.id = "roomBar";
    $bar.innerHTML = `
              <div class="room-label">ROOM</div>
              <div class="room-code">${this.roomCode}</div>
              <button class="share-button" id="shareRoom">Share Link</button>
          `;
    document.body.appendChild($bar);

    $bar.querySelector("#shareRoom").onclick = () => this._share();
  }

  async _share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my VelvetDrop Room",
          text: "Transfer files securely and elegantly.",
          url: url,
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      await navigator.clipboard.writeText(url);
      Events.fire("notify-user", "Room link copied to clipboard");
    }
  }
}

class NetworkStatusUI {
  constructor() {
    window.addEventListener("offline", (e) => this._showOfflineMessage(), false);
    window.addEventListener("online", (e) => this._showOnlineMessage(), false);
    if (!navigator.onLine) this._showOfflineMessage();
  }

  _showOfflineMessage() {
    Events.fire("notify-user", "You are offline");
  }

  _showOnlineMessage() {
    Events.fire("notify-user", "You are back online");
  }
}

class WebShareTargetUI {
  constructor() {
    const parsedUrl = new URL(window.location);
    const title = parsedUrl.searchParams.get("title");
    const text = parsedUrl.searchParams.get("text");
    const url = parsedUrl.searchParams.get("url");

    let shareTargetText = title ? title : "";
    shareTargetText += text ? (shareTargetText ? " " + text : text) : "";
    if (url) shareTargetText = url;
    if (!shareTargetText) return;
    window.shareTargetText = shareTargetText;
    history.pushState({}, "URL Rewrite", "/");
    console.log("Shared Target Text:", '"' + shareTargetText + '"');
  }
}

class VelvetDrop {
  constructor() {
    const server = new ServerConnection();
    const peers = new PeersManager(server);
    const peersUI = new PeersUI();
    Events.on("load", (e) => {
      const receiveDialog = new ReceiveDialog();
      const sendTextDialog = new SendTextDialog();
      const receiveTextDialog = new ReceiveTextDialog();
      const toast = new Toast();
      const notifications = new Notifications();
      const networkStatusUI = new NetworkStatusUI();
      const webShareTargetUI = new WebShareTargetUI();
      const roomUI = new RoomUI();
    });
  }
}

const velvetDrop = new VelvetDrop();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .then((serviceWorker) => {
      console.log("Service Worker registered");
      window.serviceWorker = serviceWorker;
    });
}

window.addEventListener("beforeinstallprompt", (e) => {
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return e.preventDefault();
  } else {
    const btn = document.querySelector("#install");
    btn.hidden = false;
    btn.onclick = (_) => e.prompt();
    return e.preventDefault();
  }
});

// ─── Background Animation — Gold & Obsidian luxury rings ───────────────────
Events.on("load", () => {
  let c = document.createElement("canvas");
  document.body.appendChild(c);
  let style = c.style;
  style.width = "100%";
  style.position = "absolute";
  style.zIndex = -1;
  style.top = 0;
  style.left = 0;
  let ctx = c.getContext("2d");
  let x0, y0, w, h, dw;

  function init() {
    w = window.innerWidth;
    h = window.innerHeight;
    c.width = w;
    c.height = h;
    let offset = h > 380 ? 100 : 65;
    offset = h > 800 ? 116 : offset;
    x0 = w / 2;
    y0 = h - offset;
    dw = Math.max(w, h, 1000) / 13;
    drawCircles();
  }
  window.onresize = init;

  function drawCircle(radius) {
    ctx.beginPath();

    // Normalised distance from centre (0 = inner, 1 = outer)
    const t = radius / Math.max(w, h);

    const isEvenRing = Math.round(t * 10) % 2 === 0;

    if (isEvenRing) {
      const opacity = 0.055 * (1 - t * 0.6);
      ctx.strokeStyle = `rgba(26,35,126,${opacity.toFixed(3)})`;
    } else {
      const opacity = 0.03 * (1 - t * 0.7);
      ctx.strokeStyle = `rgba(92,107,192,${opacity.toFixed(3)})`;
    }

    ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  let step = 0;

  function drawCircles() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      drawCircle(dw * i + (step % dw));
    }
    step += 0.6;
  }

  let loading = true;

  function animate() {
    if (loading || step % dw < dw - 5) {
      requestAnimationFrame(function () {
        drawCircles();
        animate();
      });
    }
  }

  window.animateBackground = function (l) {
    loading = l;
    animate();
  };

  init();
  animate();
});

Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked
as the user has dismissed the permission prompt several times.
This can be reset in Page Info
which can be accessed by clicking the lock icon next to the URL.`;

document.body.onclick = (e) => {
  document.body.onclick = null;
  if (!/.*Version.*Safari.*/.test(navigator.userAgent)) return;
  blop.play();
};
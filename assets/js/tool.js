/* ==========================================================================
   JPG to PNG - Offline Converter
   Classic script (no modules). Behaviour is attached to window globals and
   wired with addEventListener so the page works when opened from file://.
   All decoding and encoding happen locally via the Canvas API. No network.
   ========================================================================== */

/* ---- Configuration ------------------------------------------------------ */
var JPG_EXTENSION = /\.jpe?g$/i;
var JPEG_MIME = "image/jpeg";
var DOWNLOAD_ALL_GAP_MS = 350; /* spacing between sequential downloads */

/* Inline SVG icons (single family, monochrome, currentColor). */
var ICON_DOWNLOAD =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>' +
  '<polyline points="7 10 12 15 17 10"></polyline>' +
  '<line x1="12" y1="15" x2="12" y2="3"></line></svg>';
var ICON_IMAGE =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"' +
  ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="3" width="18" height="18" rx="2"></rect>' +
  '<circle cx="9" cy="9" r="1.6"></circle>' +
  '<path d="m21 15-4.5-4.5L5 21"></path></svg>';

/* ---- State -------------------------------------------------------------- */
var jpgToPngResults = [];           /* converted items, kept until cleared */
var jpgToPngQueue = Promise.resolve(); /* serialises batches (shared canvas) */
var jpgToPngCanvas = null;          /* reused offscreen canvas */
var jpgToPngDragDepth = 0;

/* DOM references, assigned on init */
var elFileInput, elDropzone, elResults, elToolbar, elStatus, elDownloadAll, elClear;

/* ---- Small helpers ------------------------------------------------------ */
function isJpegFile(file) {
  if (!file) { return false; }
  if (file.type) { return file.type === JPEG_MIME; }
  /* Some platforms report an empty type; fall back to the extension. */
  return JPG_EXTENSION.test(file.name || "");
}

function looksLikeJpegName(name) {
  return JPG_EXTENSION.test(name || "");
}

function toPngName(name) {
  var base = (name || "image").replace(/\.[^.\\/]+$/, "");
  if (!base) { base = "image"; }
  return base + ".png";
}

function delay(ms) {
  return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

function getCanvas() {
  if (!jpgToPngCanvas) { jpgToPngCanvas = document.createElement("canvas"); }
  return jpgToPngCanvas;
}

/* Decode a file into an ImageBitmap (orientation-correct) or an <img>. */
function decodeImage(file, srcUrl) {
  if (typeof window.createImageBitmap === "function") {
    return window.createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(function () {
        /* Older engines may not accept the options argument. */
        return window.createImageBitmap(file);
      })
      .catch(function () {
        return decodeViaImageElement(srcUrl);
      });
  }
  return decodeViaImageElement(srcUrl);
}

function decodeViaImageElement(srcUrl) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("decode failed")); };
    img.src = srcUrl;
  });
}

/* Encode the current canvas as a lossless PNG blob (async, low memory). */
function canvasToPngBlob(canvas) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (blob) { resolve(blob); }
      else { reject(new Error("PNG encoding failed")); }
    }, "image/png");
  });
}

/* ---- Result rows -------------------------------------------------------- */
function createPendingRow(name) {
  var li = document.createElement("li");
  li.className = "result is-pending";

  var thumb = document.createElement("div");
  thumb.className = "result__thumb";
  thumb.innerHTML = ICON_IMAGE;

  var body = document.createElement("div");
  body.className = "result__body";

  var nameEl = document.createElement("p");
  nameEl.className = "result__name";
  nameEl.textContent = name;
  nameEl.title = name;

  var metaEl = document.createElement("p");
  metaEl.className = "result__meta";
  metaEl.textContent = "Converting...";

  body.appendChild(nameEl);
  body.appendChild(metaEl);

  var action = document.createElement("div");
  action.className = "result__action";
  var pending = document.createElement("span");
  pending.className = "result__pending";
  pending.textContent = "Working...";
  action.appendChild(pending);

  li.appendChild(thumb);
  li.appendChild(body);
  li.appendChild(action);

  elResults.appendChild(li);
  elToolbar.hidden = false;

  return { li: li, thumb: thumb, meta: metaEl, action: action };
}

function fillRowSuccess(row, item) {
  row.li.classList.remove("is-pending");
  row.li.classList.add("is-done");

  /* Thumbnail preview from the PNG output. */
  row.thumb.innerHTML = "";
  var img = document.createElement("img");
  img.width = 64;
  img.height = 64;
  img.decoding = "async";
  img.alt = "Preview of " + item.outName;
  img.src = item.url;
  row.thumb.appendChild(img);

  row.meta.textContent = item.width + " x " + item.height + " px - PNG";

  row.action.innerHTML = "";
  var link = document.createElement("a");
  link.className = "btn btn--small btn--primary";
  link.href = item.url;
  link.download = item.outName;
  link.innerHTML = '<span class="btn__icon" aria-hidden="true">' + ICON_DOWNLOAD + "</span>";
  link.appendChild(document.createTextNode("Download PNG"));
  link.setAttribute("aria-label", "Download " + item.outName);
  row.action.appendChild(link);

  item.downloadEl = link;
}

function fillRowError(row, message, kind) {
  row.li.classList.remove("is-pending");
  row.li.classList.add("is-error");
  row.meta.textContent = message;
  row.action.innerHTML = "";
  var note = document.createElement("span");
  note.className = "result__pending";
  note.textContent = kind === "skipped" ? "Skipped" : "Failed";
  row.action.appendChild(note);
}

/* ---- Conversion --------------------------------------------------------- */
function handleFile(file) {
  var name = file.name || "image.jpg";
  var row = createPendingRow(name);

  /* Reject anything that is not a JPEG (check MIME and extension). */
  if (!isJpegFile(file) && !looksLikeJpegName(name)) {
    var item = { name: name, status: "skipped", url: null, downloadEl: null };
    jpgToPngResults.push(item);
    fillRowError(row, "Not a JPEG file", "skipped");
    return Promise.resolve();
  }

  var srcUrl = URL.createObjectURL(file);
  var record = {
    name: name,
    outName: toPngName(name),
    status: "error",
    url: null,
    width: 0,
    height: 0,
    downloadEl: null
  };
  jpgToPngResults.push(record);

  return decodeImage(file, srcUrl)
    .then(function (source) {
      var width = source.naturalWidth || source.width;
      var height = source.naturalHeight || source.height;
      if (!width || !height) { throw new Error("empty image"); }

      var canvas = getCanvas();
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0);

      if (typeof source.close === "function") { source.close(); }

      record.width = width;
      record.height = height;
      return canvasToPngBlob(canvas);
    })
    .then(function (blob) {
      record.status = "done";
      record.url = URL.createObjectURL(blob);
      fillRowSuccess(row, record);
    })
    .catch(function () {
      record.status = "error";
      fillRowError(row, "Could not read this image", "error");
    })
    .then(function () {
      /* Revoke the decode source URL in all cases. */
      URL.revokeObjectURL(srcUrl);
    });
}

function runBatch(files) {
  var i = 0;

  function next() {
    if (i >= files.length) {
      updateSummary();
      return Promise.resolve();
    }
    setStatus("Converting " + (i + 1) + " of " + files.length + "...");
    return handleFile(files[i]).then(function () {
      i += 1;
      return next();
    });
  }

  return next();
}

function processFiles(fileList) {
  var files = Array.prototype.slice.call(fileList);
  /* Reset the input so selecting the same file again still fires change. */
  if (elFileInput) { elFileInput.value = ""; }
  if (!files.length) { return; }

  jpgToPngQueue = jpgToPngQueue.then(function () {
    return runBatch(files);
  }).catch(function () { /* keep the queue alive on unexpected errors */ });
}

/* ---- Toolbar and status ------------------------------------------------- */
function setStatus(text) {
  if (elStatus) { elStatus.textContent = text; }
}

function updateSummary() {
  var done = 0, skipped = 0, failed = 0;
  for (var i = 0; i < jpgToPngResults.length; i++) {
    var s = jpgToPngResults[i].status;
    if (s === "done") { done += 1; }
    else if (s === "skipped") { skipped += 1; }
    else { failed += 1; }
  }

  var total = jpgToPngResults.length;
  var parts = [];
  if (done) { parts.push(done + " converted"); }
  if (skipped) { parts.push(skipped + " skipped"); }
  if (failed) { parts.push(failed + " failed"); }

  if (total === 0) {
    setStatus("");
  } else {
    setStatus(total + (total === 1 ? " file: " : " files: ") + parts.join(", ") + ".");
  }

  if (elDownloadAll) { elDownloadAll.disabled = done === 0; }
}

/* ---- Download all (sequential) ----------------------------------------- */
function downloadAll() {
  var ready = jpgToPngResults.filter(function (r) {
    return r.status === "done" && r.downloadEl;
  });
  if (!ready.length) { return; }

  elDownloadAll.disabled = true;
  setStatus("Downloading " + ready.length + (ready.length === 1 ? " file..." : " files..."));

  var i = 0;
  function step() {
    if (i >= ready.length) {
      elDownloadAll.disabled = false;
      updateSummary();
      return;
    }
    ready[i].downloadEl.click();
    i += 1;
    delay(DOWNLOAD_ALL_GAP_MS).then(step);
  }
  step();
}

/* ---- Clear -------------------------------------------------------------- */
function clearAll() {
  revokeAllUrls();
  jpgToPngResults = [];
  if (elResults) { elResults.innerHTML = ""; }
  if (elToolbar) { elToolbar.hidden = true; }
  setStatus("");
  if (elFileInput) { elFileInput.value = ""; }
}

function revokeAllUrls() {
  for (var i = 0; i < jpgToPngResults.length; i++) {
    if (jpgToPngResults[i].url) {
      URL.revokeObjectURL(jpgToPngResults[i].url);
      jpgToPngResults[i].url = null;
    }
  }
}

/* ---- Drag and drop ------------------------------------------------------ */
function onDragEnter(e) {
  e.preventDefault();
  jpgToPngDragDepth += 1;
  elDropzone.classList.add("is-dragover");
}

function onDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) { e.dataTransfer.dropEffect = "copy"; }
}

function onDragLeave() {
  jpgToPngDragDepth -= 1;
  if (jpgToPngDragDepth <= 0) {
    jpgToPngDragDepth = 0;
    elDropzone.classList.remove("is-dragover");
  }
}

function onDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  jpgToPngDragDepth = 0;
  elDropzone.classList.remove("is-dragover");
  var files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) { processFiles(files); }
}

/* Prevent a stray drop elsewhere on the page from navigating away. */
function preventWindowDrop(e) { e.preventDefault(); }

/* ---- Init --------------------------------------------------------------- */
function initTool() {
  elFileInput = document.getElementById("file-input");
  elDropzone = document.getElementById("dropzone");
  elResults = document.getElementById("results");
  elToolbar = document.getElementById("toolbar");
  elStatus = document.getElementById("status");
  elDownloadAll = document.getElementById("download-all");
  elClear = document.getElementById("clear");

  if (!elFileInput || !elDropzone || !elResults) { return; }

  elFileInput.addEventListener("change", function () {
    if (elFileInput.files && elFileInput.files.length) {
      processFiles(elFileInput.files);
    }
  });

  elDropzone.addEventListener("dragenter", onDragEnter);
  elDropzone.addEventListener("dragover", onDragOver);
  elDropzone.addEventListener("dragleave", onDragLeave);
  elDropzone.addEventListener("drop", onDrop);

  window.addEventListener("dragover", preventWindowDrop);
  window.addEventListener("drop", preventWindowDrop);

  if (elDownloadAll) { elDownloadAll.addEventListener("click", downloadAll); }
  if (elClear) { elClear.addEventListener("click", clearAll); }

  /* Free object URLs when the page is closed or hidden. */
  window.addEventListener("pagehide", revokeAllUrls);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTool);
} else {
  initTool();
}

/* scan.js — "Scan my folder": reads resumes/answers.md/questions.md
 * straight off disk (via the File System Access API, with a plain
 * <input webkitdirectory> fallback for file:// pages, where that API
 * is unavailable), extracts their text client-side, and asks Claude's
 * API (the visitor's own key, called directly from the browser — same
 * trust model as firecrawl.js) to infer role tracks and map each
 * resume to one. Nothing is written to Store until the visitor reviews
 * and confirms the result.
 *
 * Deliberately loads pdf.js as a classic UMD script (an older pinned
 * version — cdnjs only ships ES-module builds at latest), not via
 * dynamic import(): Chromium silently never resolves a module import
 * on a file:// page (no error, just hangs forever), which is exactly
 * the bug this avoids. Keeping this file:// too — not just the
 * directory-picker fallback — means "Scan my folder" works whether or
 * not the visitor bothered running a local server.
 */
(function (global) {
  "use strict";

  var PDFJS_VERSION = "3.11.174";
  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.js";
  var PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.js";
  var MAX_CHARS_PER_FILE = 6000;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Couldn't load " + url + " — check your internet connection.")); };
      document.head.appendChild(s);
    });
  }

  var _pdfjsPromise = null;
  function loadPdfjs() {
    if (!_pdfjsPromise) {
      _pdfjsPromise = (typeof window.pdfjsLib !== "undefined" ? Promise.resolve() : loadScript(PDFJS_URL)).then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return window.pdfjsLib;
      });
    }
    return _pdfjsPromise;
  }

  function pdfToText(arrayBuffer) {
    return loadPdfjs().then(function (pdfjsLib) {
      // disableWorker: a background Worker loaded from a cross-origin
      // (CDN) script URL is blocked on file:// pages too — resumes are
      // a page or two, so running on the main thread costs nothing
      // noticeable and sidesteps that failure mode entirely.
      return pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true }).promise.then(function (doc) {
        var pages = [];
        for (var i = 1; i <= doc.numPages; i++) pages.push(i);
        return pages.reduce(function (chain, pageNum) {
          return chain.then(function (acc) {
            return doc.getPage(pageNum).then(function (page) {
              return page.getTextContent().then(function (content) {
                var text = content.items.map(function (it) { return it.str; }).join(" ");
                return acc + text + "\n";
              });
            });
          });
        }, Promise.resolve(""));
      });
    });
  }

  function docxToText(arrayBuffer) {
    if (typeof JSZip === "undefined") return Promise.reject(new Error("JSZip did not load"));
    return JSZip.loadAsync(arrayBuffer).then(function (zip) {
      var entry = zip.file("word/document.xml");
      if (!entry) return "";
      return entry.async("string").then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, "application/xml");
        var ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        var nodes = doc.getElementsByTagNameNS(ns, "t");
        var parts = [];
        for (var i = 0; i < nodes.length; i++) parts.push(nodes[i].textContent);
        return parts.join(" ");
      });
    });
  }

  function extractText(name, file) {
    var lower = name.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".txt")) {
      return file.text();
    }
    if (lower.endsWith(".pdf")) {
      return file.arrayBuffer().then(pdfToText);
    }
    if (lower.endsWith(".docx")) {
      return file.arrayBuffer().then(docxToText);
    }
    return Promise.resolve("");
  }

  /* ---------------- gathering files ---------------- */

  function gatherFromDirectoryHandle(dirHandle) {
    var found = []; // { relativePath, file }
    return (async function () {
      for await (var entry of dirHandle.values()) {
        if (entry.kind === "file" && /^(answers|questions)\.md$/i.test(entry.name)) {
          found.push({ relativePath: entry.name, file: await entry.getFile() });
        }
        if (entry.kind === "directory" && entry.name.toLowerCase() === "resumes") {
          for await (var rentry of entry.values()) {
            if (rentry.kind === "file" && /\.(pdf|docx)$/i.test(rentry.name)) {
              found.push({ relativePath: "resumes/" + rentry.name, file: await rentry.getFile() });
            }
          }
        }
      }
      return found;
    })();
  }

  function gatherFromFileList(fileList) {
    var found = [];
    Array.prototype.forEach.call(fileList, function (file) {
      var rel = file.webkitRelativePath || file.name;
      var parts = rel.split("/");
      var tail = parts.slice(1).join("/"); // strip the top folder name
      if (/^(answers|questions)\.md$/i.test(tail) || /^resumes\/[^/]+\.(pdf|docx)$/i.test(tail)) {
        found.push({ relativePath: tail, file: file });
      }
    });
    return Promise.resolve(found);
  }

  function classify(entries) {
    var manifest = { resumes: [], notes: [] };
    var chain = Promise.resolve();
    entries.forEach(function (entry) {
      chain = chain.then(function () {
        return extractText(entry.relativePath, entry.file).then(function (text) {
          text = (text || "").trim().slice(0, MAX_CHARS_PER_FILE);
          if (!text) return;
          if (entry.relativePath.toLowerCase().indexOf("resumes/") === 0) {
            manifest.resumes.push({ name: entry.relativePath.replace(/^resumes\//i, ""), text: text });
          } else {
            manifest.notes.push({ name: entry.relativePath, text: text });
          }
        }).catch(function () { /* skip unreadable file, keep going */ });
      });
    });
    return chain.then(function () { return manifest; });
  }

  /* ---------------- Claude API ---------------- */

  var CLAUDE_MODEL = "claude-sonnet-5";
  var SYSTEM_PROMPT = "You are helping set up a personal job-search tool by reading someone's " +
    "resume file(s) and, if present, their own notes about what they're looking for. Infer their " +
    "distinct job-search 'role tracks' — one track per genuinely different job family they seem to " +
    "be targeting (don't split near-duplicate resumes into separate tracks unless they clearly aim " +
    "at different roles). For each track: name it in plain, short terms a job board would use " +
    "(e.g. 'IT Support', 'Software Developer'); map it to the single resume file name that fits it " +
    "best; and suggest realistic default search parameters — role keywords to search for, a likely " +
    "city or 'remote' if the resume states a location, and a years-of-experience range — based only " +
    "on what the resume(s) actually show. Keep rationale to one sentence per track.";

  function buildPrompt(manifest) {
    var parts = [];
    manifest.resumes.forEach(function (r) {
      parts.push("=== RESUME FILE: resumes/" + r.name + " ===\n" + r.text);
    });
    manifest.notes.forEach(function (n) {
      parts.push("=== NOTE FILE: " + n.name + " ===\n" + n.text);
    });
    return parts.join("\n\n");
  }

  function analyze(apiKey, manifest) {
    var body = {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(manifest) }],
      tools: [{
        name: "save_role_tracks",
        description: "Save the inferred role tracks with their resume mapping and search defaults.",
        input_schema: {
          type: "object",
          properties: {
            tracks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  resumeFile: { type: "string", description: "Exact resume file name this track uses." },
                  roleKeywords: { type: "string", description: "Role/title text to search for." },
                  suggestedCity: { type: "string" },
                  expMin: { type: "number" },
                  expMax: { type: "number" },
                  rationale: { type: "string" }
                },
                required: ["name", "resumeFile", "roleKeywords"]
              }
            },
            summary: { type: "string" }
          },
          required: ["tracks"]
        }
      }],
      tool_choice: { type: "tool", name: "save_role_tracks" }
    };

    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 60000);

    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) {
          var msg = (json && json.error && json.error.message) || (res.status + " " + res.statusText);
          throw new Error(msg);
        }
        var block = (json.content || []).find(function (b) { return b.type === "tool_use"; });
        if (!block) throw new Error("Claude didn't return structured tracks — try again.");
        return block.input;
      });
    }).catch(function (err) {
      if (err && err.name === "AbortError") throw new Error("Claude took too long to respond (60s) — try again.");
      throw err;
    }).finally(function () { clearTimeout(timeout); });
  }

  /* ---------------- public entry point ---------------- */

  /** Runs the whole flow. `onStatus(text)` reports progress.
   * Resolves with { tracks, summary, manifest } for the caller to
   * show a review UI before committing anything to Store. */
  function scanAndAnalyze(opts) {
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    var apiKey = Store.getAnthropicKey();
    if (!apiKey) return Promise.reject(new Error("Add a Claude API key in Settings first — scanning needs it to read your resumes."));

    var gather;
    if (opts.dirHandle) {
      gather = gatherFromDirectoryHandle(opts.dirHandle);
    } else if (opts.fileList) {
      gather = gatherFromFileList(opts.fileList);
    } else {
      return Promise.reject(new Error("No folder or files given to scan."));
    }

    onStatus("Reading files…");
    return gather.then(function (entries) {
      if (entries.length === 0) throw new Error("No resumes/ files or answers.md/questions.md found in that folder.");
      return classify(entries);
    }).then(function (manifest) {
      if (manifest.resumes.length === 0) throw new Error("Found notes but no readable resumes (.pdf/.docx) under resumes/.");
      onStatus("Asking Claude to read " + manifest.resumes.length + " resume" + (manifest.resumes.length === 1 ? "" : "s") + "…");
      return analyze(apiKey, manifest).then(function (result) {
        return { tracks: result.tracks || [], summary: result.summary || "", manifest: manifest };
      });
    });
  }

  /** The File System Access API needs a "secure context" and is
   * entirely unavailable on file:// pages — Chromium doesn't reject the
   * call there, it just never resolves, which looks like a silent hang.
   * So a bare file:// page must use the <input webkitdirectory>
   * fallback (works regardless of origin) even where the function
   * exists on window. */
  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === "function" && window.location.protocol !== "file:";
  }

  global.Scan = {
    scanAndAnalyze: scanAndAnalyze,
    supportsDirectoryPicker: supportsDirectoryPicker
  };
})(window);

/* scan.js — "Scan my folder": reads resumes/answers.md/questions.md
 * straight off disk (via the File System Access API, with a plain
 * <input webkitdirectory> fallback), extracts their text client-side,
 * and asks Claude's API (the visitor's own key, called directly from
 * the browser — same trust model as firecrawl.js) to infer role tracks
 * and map each resume to one. Nothing is written to Store until the
 * visitor reviews and confirms the result.
 *
 * Requires a Chromium-based browser for the directory picker
 * (window.showDirectoryPicker) and, either way, a page served over
 * http(s) — not file:// — because that API and the ES-module CDN
 * builds this file lazy-loads both require a secure/regular origin.
 */
(function (global) {
  "use strict";

  var PDFJS_VERSION = "6.3.289";
  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.mjs";
  var PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.mjs";
  var MAX_CHARS_PER_FILE = 6000;

  var _pdfjsPromise = null;
  function loadPdfjs() {
    if (!_pdfjsPromise) {
      _pdfjsPromise = import(PDFJS_URL).then(function (mod) {
        mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return mod;
      });
    }
    return _pdfjsPromise;
  }

  function pdfToText(arrayBuffer) {
    return loadPdfjs().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (doc) {
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

    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
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
    });
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

  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === "function";
  }

  global.Scan = {
    scanAndAnalyze: scanAndAnalyze,
    supportsDirectoryPicker: supportsDirectoryPicker
  };
})(window);

/* app.js — UI wiring for Claim. No framework: plain DOM + the Store and
 * Firecrawl globals defined in store.js / firecrawl.js (loaded first). */
(function () {
  "use strict";

  var AGGREGATOR_HINTS = [
    "linkedin.", "indeed.", "facebook.", "instagram.", "reddit.", "glassdoor.",
    "ziprecruiter.", "monster.", "talent.com", "jooble.", "workopolis.",
    "simplyhired.", "careerbeacon.", "eluta.ca", "jobbank.gc.ca", "jobboom."
  ];

  function isDirect(url) {
    try {
      var host = new URL(url).hostname.replace(/^www\./, "");
      return !AGGREGATOR_HINTS.some(function (h) { return host.indexOf(h) !== -1; });
    } catch (e) { return true; }
  }

  function icon(path, extra) {
    return '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor">' + path + '</svg>';
  }
  var ARROW_SVG = icon('<path d="M2 8L8 2M8 2H3.5M8 2V6.5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>');
  var CHECK_SVG = '<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var GEAR_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.5 3.5l-1.1 1.1M4.6 11.3l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.7 3.5 3.6"/></svg>';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function trackMeta(tracks, name) {
    return tracks.find(function (t) { return t.name === name; }) || { name: name, key: "fallback" };
  }

  /* ---------------- state ---------------- */
  var state = { docs: [], activeTracks: new Set(), status: "all", query: "", sort: "new" };

  function refreshDocs() {
    state.docs = Store.getListings();
    if (state.activeTracks.size === 0) {
      state.activeTracks = new Set(Store.getTracks().map(function (t) { return t.name; }));
    }
  }

  /* ---------------- tabs ---------------- */
  document.querySelectorAll(".tabs button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll("section.tabpanel").forEach(function (s) { s.hidden = true; });
      document.getElementById("panel-" + btn.dataset.tab).hidden = false;
    });
  });

  /* ---------------- settings modal ---------------- */
  var modal = document.getElementById("settingsModal");
  document.getElementById("openSettings").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", function () { modal.hidden = true; });
  modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });

  function openSettings() {
    document.getElementById("apiKeyInput").value = Store.getKey();
    renderTrackEditor();
    modal.hidden = false;
  }

  document.getElementById("saveKeyBtn").addEventListener("click", function () {
    Store.setKey(document.getElementById("apiKeyInput").value.trim());
    document.getElementById("keyStatus").textContent = "Saved to this browser.";
  });
  document.getElementById("clearKeyBtn").addEventListener("click", function () {
    Store.setKey("");
    document.getElementById("apiKeyInput").value = "";
    document.getElementById("keyStatus").textContent = "Cleared. Search still works keyless (lower rate limit).";
  });

  function renderTrackEditor() {
    var wrap = document.getElementById("trackEditor");
    wrap.innerHTML = "";
    Store.getTracks().forEach(function (t) {
      var row = el("div", "field");
      row.innerHTML =
        '<label>' + escapeHtml(t.name) + ' &mdash; resume file to use</label>' +
        '<input type="text" data-track="' + escapeHtml(t.name) + '" placeholder="e.g. resume-' + t.key + '.pdf" value="' + escapeHtml(t.resumeHint || "") + '">';
      wrap.appendChild(row);
    });
    wrap.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var tracks = Store.getTracks();
        tracks.forEach(function (t) { if (t.name === inp.dataset.track) t.resumeHint = inp.value; });
        Store.setTracks(tracks);
        populateTrackSelect();
        renderBoard();
      });
    });
  }

  document.getElementById("addTrackBtn").addEventListener("click", function () {
    var input = document.getElementById("newTrackInput");
    var name = input.value.trim();
    if (!name) return;
    Store.addTrack(name);
    input.value = "";
    renderTrackEditor();
    populateTrackSelect();
  });

  /* ---------------- search form ---------------- */
  function populateTrackSelect() {
    var sel = document.getElementById("trackSelect");
    var current = sel.value;
    sel.innerHTML = "";
    Store.getTracks().forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.name; o.textContent = t.name;
      sel.appendChild(o);
    });
    if (current) sel.value = current;
  }

  var searchForm = document.getElementById("searchForm");
  var searchStatus = document.getElementById("searchStatus");
  var searchBtn = document.getElementById("searchBtn");

  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    runSearch();
  });

  function setStatus(html, isErr) {
    searchStatus.innerHTML = isErr ? '<span class="err">' + html + '</span>' : html;
  }

  function runSearch() {
    var role = document.getElementById("roleInput").value.trim();
    var city = document.getElementById("cityInput").value.trim() || "remote";
    var expMin = document.getElementById("expMinInput").value || "0";
    var expMax = document.getElementById("expMaxInput").value || expMin;
    var freshness = document.getElementById("freshnessSelect").value;
    var track = document.getElementById("trackSelect").value;
    var limit = parseInt(document.getElementById("limitInput").value, 10) || 15;
    var enrichTop = parseInt(document.getElementById("enrichInput").value, 10);
    if (isNaN(enrichTop)) enrichTop = Store.getSettings().enrichTop;

    if (!role) { setStatus("Enter a role to search for.", true); return; }

    var key = Store.getKey();
    var settings = Store.getSettings();
    var query = role + " jobs in " + city + " " + expMin + " to " + expMax + " years experience";

    searchBtn.disabled = true;
    setStatus("Searching Firecrawl for “" + escapeHtml(query) + "”…");

    var totalCredits = 0;

    Firecrawl.search({ query: query, limit: limit, excludeDomains: settings.excludeDomains, freshness: freshness, key: key })
      .then(function (res) {
        if (res.creditsUsed) totalCredits += res.creditsUsed;
        var results = res.results.filter(function (r) { return r && r.url; });
        if (results.length === 0) {
          setStatus("No results came back. Try a broader city/role or a wider freshness window.", true);
          searchBtn.disabled = false;
          return;
        }

        var toEnrich = results.slice(0, Math.max(0, enrichTop));
        var rest = results.slice(toEnrich.length);
        var today = new Date().toISOString().slice(0, 10);
        var base = Date.now();
        var rows = [];

        function addUnverified(r, idx) {
          rows.push({
            loggedAt: base - idx,
            dateSearched: today,
            roleTrack: track,
            title: r.title || "(untitled listing)",
            company: "Not confirmed — open the link",
            experience: "Not confirmed",
            location: city,
            applyLink: r.url,
            source: (r.description || "").slice(0, 140),
            direct: isDirect(r.url),
            verified: false
          });
        }

        var chain = Promise.resolve();
        toEnrich.forEach(function (r, idx) {
          chain = chain.then(function () {
            setStatus("Reading listing " + (idx + 1) + " of " + toEnrich.length + "… (" + totalCredits + " credits used so far)");
            return Firecrawl.extractJobFields(r.url, key).then(function (ex) {
              if (ex.creditsUsed) totalCredits += ex.creditsUsed;
              var f = ex.fields || {};
              if (f.isJobPosting === false) return; // skip non-postings
              rows.push({
                loggedAt: base - idx,
                dateSearched: today,
                roleTrack: track,
                title: f.jobTitle || r.title || "(untitled listing)",
                company: f.company || "Not specified",
                experience: f.experienceRequired || (expMin + "-" + expMax + " yrs (requested)"),
                location: f.location || city,
                applyLink: r.url,
                source: f.salary ? ("Salary: " + f.salary) : (r.description || "").slice(0, 140),
                direct: isDirect(r.url),
                verified: true
              });
            }).catch(function () {
              addUnverified(r, idx);
            });
          });
        });

        chain.then(function () {
          rest.forEach(function (r, idx) { addUnverified(r, toEnrich.length + idx); });
          Store.addListings(rows);
          refreshDocs();
          renderAll();
          setStatus(rows.length + " listing" + (rows.length === 1 ? "" : "s") + " added to your board — " + totalCredits + " Firecrawl credits used.");
          searchBtn.disabled = false;
          document.querySelector('.tabs button[data-tab="board"]').click();
        });
      })
      .catch(function (err) {
        setStatus("Search failed: " + escapeHtml(err.message), true);
        searchBtn.disabled = false;
      });
  }

  /* ---------------- board ---------------- */
  var chipRow = document.getElementById("chipRow");
  var cardList = document.getElementById("cardList");
  var boardMeta = document.getElementById("boardMeta");

  function renderChips() {
    chipRow.innerHTML = "";
    var tracks = Store.getTracks();
    var counts = {};
    tracks.forEach(function (t) { counts[t.name] = 0; });
    state.docs.forEach(function (d) { if (counts[d.roleTrack] != null) counts[d.roleTrack]++; else counts[d.roleTrack] = 1; });

    var allNames = tracks.map(function (t) { return t.name; });
    var allChip = el("button", "chip all" + (state.activeTracks.size === allNames.length ? " active" : ""),
      '<span class="dot"></span>All <span class="count">' + state.docs.length + '</span>');
    allChip.onclick = function () { state.activeTracks = new Set(allNames); renderAll(); };
    chipRow.appendChild(allChip);

    tracks.forEach(function (t) {
      var active = state.activeTracks.has(t.name);
      var chip = el("button", "chip" + (active ? " active" : ""),
        '<span class="dot"></span>' + escapeHtml(t.name) + ' <span class="count">' + (counts[t.name] || 0) + '</span>');
      chip.style.setProperty("--dot", "var(--track-" + t.key + ", var(--track-fallback))");
      chip.style.setProperty("--dot-soft", "var(--track-" + t.key + "-soft, var(--track-fallback-soft))");
      chip.onclick = function () {
        if (state.activeTracks.has(t.name) && state.activeTracks.size === 1) {
          state.activeTracks = new Set(allNames);
        } else if (state.activeTracks.size === allNames.length) {
          state.activeTracks = new Set([t.name]);
        } else if (state.activeTracks.has(t.name)) {
          state.activeTracks.delete(t.name);
        } else {
          state.activeTracks.add(t.name);
        }
        renderAll();
      };
      chipRow.appendChild(chip);
    });
  }

  function matches(d) {
    if (!state.activeTracks.has(d.roleTrack)) return false;
    if (state.status === "open" && d.applied) return false;
    if (state.status === "applied" && !d.applied) return false;
    if (state.query) {
      var q = state.query.toLowerCase();
      if ((d.title + " " + d.company).toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function sortDocs(list) {
    var copy = list.slice();
    if (state.sort === "company") copy.sort(function (a, b) { return (a.company || "").localeCompare(b.company || ""); });
    else if (state.sort === "track") copy.sort(function (a, b) { return (a.roleTrack || "").localeCompare(b.roleTrack || ""); });
    else copy.sort(function (a, b) { return (b.loggedAt || 0) - (a.loggedAt || 0); });
    return copy;
  }

  function renderBoard() {
    var tracks = Store.getTracks();
    renderChips();
    var filtered = sortDocs(state.docs.filter(matches));
    cardList.innerHTML = "";

    if (state.docs.length === 0) {
      cardList.appendChild(el("div", "empty", "No listings yet — run a search on the New Search tab, or import a CSV below."));
      return;
    }
    if (filtered.length === 0) {
      cardList.appendChild(el("div", "empty", "No listings match these filters."));
      return;
    }

    filtered.forEach(function (d) {
      var t = trackMeta(tracks, d.roleTrack);
      var card = el("div", "jobcard");

      var main = el("div", "main");
      var top = el("div", "toprow");
      var pill = el("span", "track-pill", '<span class="dot"></span>' + escapeHtml(d.roleTrack));
      pill.style.setProperty("--pill-soft", "var(--track-" + t.key + "-soft, var(--track-fallback-soft))");
      pill.style.setProperty("--pill-ink", "var(--track-" + t.key + ", var(--track-fallback))");
      top.appendChild(pill);
      top.appendChild(el("span", "badge " + (d.direct ? "direct" : ""), d.direct ? "Career page" : "Aggregator"));
      if (d.verified === false) top.appendChild(el("span", "badge unverified", "Unverified"));
      main.appendChild(top);

      main.appendChild(el("h3", "", escapeHtml(d.title)));
      main.appendChild(el("div", "company", escapeHtml(d.company)));
      main.appendChild(el("div", "metarow",
        "<span>" + escapeHtml(d.location || "—") + "</span><span>" + escapeHtml(d.experience || "—") + "</span><span>" + escapeHtml(d.dateSearched || "") + "</span>"));
      if (d.source) main.appendChild(el("div", "note", escapeHtml(d.source)));
      card.appendChild(main);

      var side = el("div", "side");
      var a = document.createElement("a");
      a.href = d.applyLink; a.target = "_blank"; a.rel = "noopener";
      a.className = "apply-btn";
      a.innerHTML = "Apply " + ARROW_SVG;
      side.appendChild(a);

      var box = el("button", "applybox" + (d.applied ? " on" : ""),
        '<span class="box">' + (d.applied ? CHECK_SVG : "") + '</span>' + (d.applied ? "Applied" : "Mark applied"));
      box.onclick = function () {
        Store.setApplied(d.id, !d.applied);
        refreshDocs();
        renderAll();
      };
      side.appendChild(box);

      var rm = el("button", "removebtn", "Remove");
      rm.onclick = function () {
        Store.remove(d.id);
        refreshDocs();
        renderAll();
      };
      side.appendChild(rm);

      card.appendChild(side);
      cardList.appendChild(card);
    });
  }

  function renderMeta() {
    if (state.docs.length === 0) { boardMeta.textContent = ""; return; }
    var applied = state.docs.filter(function (d) { return d.applied; }).length;
    boardMeta.textContent = state.docs.length + " listings · " + applied + " applied";
  }

  function renderLegend() {
    var grid = document.getElementById("legendGrid");
    grid.innerHTML = "";
    Store.getTracks().forEach(function (t) {
      var row = el("div", "legend-row");
      var pill = el("span", "track-pill", '<span class="dot"></span>' + escapeHtml(t.name));
      pill.style.setProperty("--pill-soft", "var(--track-" + t.key + "-soft, var(--track-fallback-soft))");
      pill.style.setProperty("--pill-ink", "var(--track-" + t.key + ", var(--track-fallback))");
      row.appendChild(pill);
      row.appendChild(el("span", "note", t.resumeHint ? escapeHtml(t.resumeHint) : "(set in Settings)"));
      grid.appendChild(row);
    });
  }

  function renderAll() {
    renderBoard();
    renderMeta();
    renderLegend();
  }

  document.getElementById("boardSearch").addEventListener("input", function (e) { state.query = e.target.value; renderAll(); });
  document.getElementById("sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; renderAll(); });
  document.querySelectorAll("#statusSeg button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#statusSeg button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      state.status = btn.dataset.status;
      renderAll();
    });
  });

  /* ---------------- CSV export / import ---------------- */
  var CSV_COLS = ["dateSearched", "roleTrack", "title", "company", "experience", "location", "applyLink", "source", "direct", "applied"];

  function toCsv(rows) {
    var lines = [CSV_COLS.join(",")];
    rows.forEach(function (r) {
      lines.push(CSV_COLS.map(function (c) {
        var v = r[c] == null ? "" : String(r[c]);
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(","));
    });
    return lines.join("\n");
  }

  function parseCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (!lines.length) return [];
    var headerLine = lines.shift();
    var headers = splitCsvLine(headerLine);
    return lines.map(function (line) {
      var vals = splitCsvLine(line);
      var row = {};
      headers.forEach(function (h, i) { row[h] = vals[i]; });
      return row;
    });
  }
  function splitCsvLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  document.getElementById("exportCsvBtn").addEventListener("click", function () {
    var csv = toCsv(sortDocs(Store.getListings()));
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "claim-listings.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importCsvInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseCsv(String(reader.result));
      var base = Date.now();
      var rows = parsed.map(function (r, idx) {
        return {
          loggedAt: base - idx,
          dateSearched: r.dateSearched || new Date().toISOString().slice(0, 10),
          roleTrack: r.roleTrack || Store.getTracks()[0].name,
          title: r.title || "(untitled)",
          company: r.company || "Not specified",
          experience: r.experience || "Not specified",
          location: r.location || "",
          applyLink: r.applyLink || "#",
          source: r.source || "",
          direct: r.direct === "true",
          verified: true
        };
      });
      Store.addListings(rows);
      refreshDocs();
      renderAll();
      setStatus("Imported " + rows.length + " rows from CSV.");
      document.querySelector('.tabs button[data-tab="board"]').click();
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------------- boot ---------------- */
  populateTrackSelect();
  refreshDocs();
  renderAll();
})();

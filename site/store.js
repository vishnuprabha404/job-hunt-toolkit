/* store.js — everything this app remembers lives in the visitor's own
 * browser (localStorage). Nothing here ever leaves the machine except
 * the direct calls firecrawl.js makes to api.firecrawl.dev. */
(function (global) {
  "use strict";

  var LISTINGS_KEY = "claim.listings.v1";
  var TRACKS_KEY = "claim.tracks.v1";
  var KEY_KEY = "claim.firecrawlKey.v1";
  var SETTINGS_KEY = "claim.settings.v1";

  var DEFAULT_TRACKS = [
    { name: "IT Support", key: "itsupport" },
    { name: "Software Developer", key: "swdev" },
    { name: "Business/QA Analyst", key: "bizqa" },
    { name: "Data Analyst", key: "data" },
    { name: "Cybersecurity", key: "cyber" }
  ];

  var DEFAULT_SETTINGS = {
    excludeDomains: ["linkedin.com", "indeed.com", "facebook.com", "instagram.com", "reddit.com", "glassdoor.com", "ziprecruiter.com", "monster.com"],
    enrichTop: 6
  };

  function safeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // djb2 — stable short id from a URL string, so re-adding the same
  // listing (same apply link) updates it instead of duplicating it.
  function hashId(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return "l" + Math.abs(h).toString(36);
  }

  var Store = {
    hashId: hashId,

    getTracks: function () {
      return safeGet(TRACKS_KEY, DEFAULT_TRACKS);
    },
    setTracks: function (tracks) {
      safeSet(TRACKS_KEY, tracks);
      return tracks;
    },
    addTrack: function (name) {
      var tracks = Store.getTracks();
      if (tracks.some(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) return tracks;
      var key = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "custom";
      return Store.setTracks(tracks.concat([{ name: name, key: key }]));
    },

    getKey: function () { return safeGet(KEY_KEY, ""); },
    setKey: function (k) { safeSet(KEY_KEY, k || ""); },

    getSettings: function () {
      var s = safeGet(SETTINGS_KEY, null);
      return s || DEFAULT_SETTINGS;
    },
    setSettings: function (s) { safeSet(SETTINGS_KEY, s); },

    getListings: function () {
      return safeGet(LISTINGS_KEY, []);
    },

    /** Prepend/merge rows (newest first). Existing rows with the same
     * id (same apply link) are updated but keep their `applied` state. */
    addListings: function (rows) {
      var existing = Store.getListings();
      var byId = {};
      existing.forEach(function (r) { byId[r.id] = r; });

      rows.forEach(function (row) {
        var id = row.id || hashId(row.applyLink || (row.title + row.company));
        var prior = byId[id];
        var merged = Object.assign({}, row, {
          id: id,
          applied: prior ? prior.applied : false,
          appliedAt: prior ? prior.appliedAt : null
        });
        byId[id] = merged;
      });

      var all = Object.keys(byId).map(function (id) { return byId[id]; });
      all.sort(function (a, b) { return (b.loggedAt || 0) - (a.loggedAt || 0); });
      safeSet(LISTINGS_KEY, all);
      return all;
    },

    setApplied: function (id, applied) {
      var all = Store.getListings();
      all.forEach(function (r) {
        if (r.id === id) {
          r.applied = applied;
          r.appliedAt = applied ? Date.now() : null;
        }
      });
      safeSet(LISTINGS_KEY, all);
      return all;
    },

    remove: function (id) {
      var all = Store.getListings().filter(function (r) { return r.id !== id; });
      safeSet(LISTINGS_KEY, all);
      return all;
    },

    clearAll: function () {
      safeSet(LISTINGS_KEY, []);
      return [];
    }
  };

  global.Store = Store;
  global.DEFAULT_TRACKS = DEFAULT_TRACKS;
})(window);

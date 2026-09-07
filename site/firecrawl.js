/* firecrawl.js — thin wrapper over Firecrawl's public REST API, called
 * directly from the browser. Confirmed live (2026-09-07): the API sends
 * `access-control-allow-origin: *` so cross-origin fetch works, and both
 * /v1/search and /v1/scrape accept requests with no Authorization header
 * at all (keyless, rate-limited) — a pasted key just raises the ceiling
 * to the full free tier. Nothing here ever touches a server of ours;
 * calls go straight from this page to api.firecrawl.dev using whatever
 * key (or no key) is stored locally. */
(function (global) {
  "use strict";

  var BASE = "https://api.firecrawl.dev/v1";

  function headers(key) {
    var h = { "Content-Type": "application/json" };
    if (key) h["Authorization"] = "Bearer " + key;
    return h;
  }

  function postJson(path, body, key) {
    return fetch(BASE + path, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || json.success === false) {
          var msg = (json && json.error) || (res.status + " " + res.statusText);
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  var FRESHNESS_TBS = { day: "qdr:d", week: "qdr:w", month: "qdr:m", any: undefined };

  /** Search the web. Returns { results: [{url,title,description}], creditsUsed }. */
  function search(opts) {
    var body = {
      query: opts.query,
      limit: opts.limit || 15
    };
    if (opts.excludeDomains && opts.excludeDomains.length) body.excludeDomains = opts.excludeDomains;
    var tbs = FRESHNESS_TBS[opts.freshness];
    if (tbs) body.tbs = tbs;

    return postJson("/search", body, opts.key).then(function (json) {
      var results = (json.data && json.data.web) || json.data || [];
      return { results: results, creditsUsed: json.creditsUsed || null };
    });
  }

  /** Scrape one URL and ask Firecrawl to extract job-posting fields as
   * JSON matching this schema. `prompt` steers the extraction; Firecrawl
   * does the extraction on its side — no separate LLM key needed here. */
  function extractJobFields(url, key) {
    var body = {
      url: url,
      formats: ["json"],
      onlyMainContent: true,
      jsonOptions: {
        schema: {
          type: "object",
          properties: {
            isJobPosting: { type: "boolean" },
            jobTitle: { type: "string" },
            company: { type: "string" },
            location: { type: "string" },
            experienceRequired: { type: "string" },
            salary: { type: "string" }
          },
          required: ["isJobPosting"]
        },
        prompt: "Is this page a single specific job posting? If yes, extract the job title, hiring company, location, required years of experience (as written), and salary if listed. If this page is not a specific job posting (e.g. a search results page, a general careers landing page, or an unrelated page), set isJobPosting to false and leave the other fields empty."
      }
    };
    return postJson("/scrape", body, key).then(function (json) {
      var data = (json.data && json.data.json) || {};
      var credits = (json.data && json.data.metadata && json.data.metadata.creditsUsed) || null;
      return { fields: data, creditsUsed: credits };
    });
  }

  global.Firecrawl = { search: search, extractJobFields: extractJobFields };
})(window);

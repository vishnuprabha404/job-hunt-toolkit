# Job Search Setup

This is **job-hunt-toolkit** — a public, reusable repo (see `README.md`) built around a personal
job-hunting workflow. It has one piece of real source code, the static site in `site/`, plus a
reference document, `Claude_x_Firecrawl_Job_Hunting_Workflow.docx` ("Make Claude Do Your Job
Hunting" by Aevy TV), which defines the chat-based workflow below. When asked to "work in this
repo," that means one of two things: *execute* the job-search workflow via chat (search jobs,
match resume, export tables), or make changes to the `site/` web app — check which the user
means. See `README.md` for the full picture of how the two fit together and what's
personal-vs-committed (`.gitignore`).

## What the workflow is

Use the **Firecrawl** MCP connector so Claude can open real webpages (via Firecrawl's cloud
browsers) instead of relying on shallow built-in search. Firecrawl tools are available in this
environment as `mcp__claude_ai_firecrawl__*` (search, scrape, map, agent, monitor, research, etc.)
and `mcp__claude_ai_Firecrawl__authenticate` for connecting/re-authing the account. Free tier =
1,000 credits/month (1 credit ≈ 1 page read).

**Scraping guidance:** prefer company career pages; skip LinkedIn and Indeed (they block
scrapers).

## The two core prompts

**Prompt 1 — Find the jobs:**
> Find me [role] jobs in [city] for [X to Y] years of experience, posted this week. Prefer company
> career pages and skip LinkedIn and Indeed. Put everything in one table: role, company,
> experience required, location, apply link.

Output as one table. If the user wants a file, export it (e.g. as Excel/CSV).

**Prompt 2 — Match resume and find the gap** (run after attaching the user's resume to the same
table from Prompt 1):
> Here is my resume. Compare it against every job in the table above.
> 1) Keep only the listings that genuinely fit me and rank them best match first, with one line
>    on why.
> 2) Then list the skills that keep appearing across these listings that my resume does not have
>    yet, and tell me which one to learn first.

Repeat daily with fresh listings (new chat/session, same prompts).

**Multiple roles:** if the user is job hunting across more than one role (e.g. "Marketing
Manager" and "Backend Developer"), pick per the roles' similarity:
- *Different roles* — run Prompt 1 separately per role (own table each), and run Prompt 2
  separately per role too, since resume fit and skill gaps differ by role.
- *Related/adjacent roles* — combine into one Prompt 1 by listing all roles and adding a
  "role searched" column to the output table, e.g.:
  > Find me jobs for these roles: [Role A], [Role B], [Role C] in [city] for [X to Y] years of
  > experience, posted this week. Prefer company career pages and skip LinkedIn and Indeed. Put
  > everything in one table: role searched, title, company, experience required, location, apply
  > link.

## Subscription requirement

No paid Claude plan is needed. Free accounts get **one custom connector slot**, which is exactly
what this setup uses (the Firecrawl connector). A paid plan only raises connector-slot count and
usage limits — it doesn't unlock anything this workflow requires. The real limiting factor is
Firecrawl's own free tier (1,000 credits/month, ~1,000 pages read), shared across all roles/runs.

## Other uses of the same connector (from the doc)

The doc lists reusable prompt patterns for the same Firecrawl setup beyond job search:
- **Price comparison**: table of store, price, product link across retailers.
- **Reading list**: turn a topic into a doc of top articles (title, link, 2-line summary).
- **Cold outreach**: pull public HR/careers emails from a list of company sites.
- **Competitor watch**: summarize a competitor's pricing/features page into a comparison table.
- **Catalog scan**: list every product (name, price, link) from a store's catalog.
- **Docs → cheat sheet**: turn a set of documentation pages into a one-page command/steps sheet.

Apply the same "one clean table / doc, cite sources, skip scraper-blocked sites" pattern when the
user asks for one of these.

## Alternative scraping connectors (fallback if Firecrawl runs out or a site resists it)

| Provider | Connector URL | Notes |
|---|---|---|
| Tavily | `https://mcp.tavily.com/mcp/` | Closest like-for-like swap; search/extract/crawl. |
| Exa | `https://mcp.exa.ai/mcp` | Meaning-based search; company/LinkedIn research tools. |
| Bright Data | `https://mcp.brightdata.com/mcp?token=YOUR_API_KEY` | Best for bot-walled sites (Amazon, LinkedIn); key is a secret. |
| Jina AI | `https://mcp.jina.ai/v1` | Lightweight page-to-clean-text reader, no sign-in needed. |

## Workspace files

- `questions.md` — checklist to work through before starting a search (role, location,
  experience, comp, cadence, etc.).
- `answers.md` — this user's filled-in answers, derived from `resumes/` plus follow-up questions.
  Read this before running a search instead of re-asking what's already answered there.
- `resumes/` — tailored resume/cover-letter PDFs (and one `.docx`) per role track. Match the
  resume file to the role track being searched (see `answers.md` item 17 for the mapping) when
  running Prompt 2 (resume match/skill-gap).
- `results.xlsx` — running log of every search run from the chat workflow. See "Results log"
  below.
- `answers.example.md` — the committed, generic template (a friend cloning the repo copies this
  to their own gitignored `answers.md`).
- `site/` — **Claim**, the standalone client-side job board. Calls Firecrawl's API directly from
  the browser (confirmed working: open CORS, works keyless too) — no backend, no Claude sign-in.
  Its data (API key, listings, applied status) lives in the visitor's browser localStorage, never
  in this repo. See "The website (`site/`)" below.

## Results log (`results.xlsx`)

**Every time a search (Prompt 1) is run, log the results to `results.xlsx` in this directory —
don't just print the table in-chat and drop it.** Rules:

- **Newest search on top.** New rows go directly under the header, pushing all previously logged
  rows down — the sheet reads most-recent-search-first, not chronological/append-at-bottom.
- **Columns:** `Date Searched | Role Track | Role / Title | Company | Experience Required |
  Location | Apply Link | Source / Notes`. Role Track is one of the tracks from `answers.md`
  (IT Support, Software Developer, Business/QA Analyst, Data Analyst, Cybersecurity) so the log
  stays filterable/sortable by track.
- **Apply Link** should be a real hyperlink in the cell, not just plain text.
- **Source / Notes** should flag anything the user should know at a glance: salary if listed,
  whether it came from a direct company career page vs. an aggregator (aggregators are a
  fallback, not the default — see the doc's LinkedIn/Indeed-skip guidance), and any caveat (e.g.
  "not Sudbury", "posting is stale").
- Building/editing the sheet requires the `openpyxl` Python package (`pip3 install --user
  openpyxl` if missing — it's not preinstalled). Read the existing file's rows before rewriting it
  so a new search prepends rather than clobbers prior entries.

## The website (`site/`)

**Claim** is a plain static site (`site/index.html` + `app.js` + `store.js` + `firecrawl.js` +
`styles.css`) — no build step, no framework, no server. It calls `https://api.firecrawl.dev`
directly from the browser using a key the visitor pastes into Settings (or no key at all —
Firecrawl's API works keyless, just rate-limited harder; confirmed live on 2026-09-07: the API
sends `access-control-allow-origin: *`, so cross-origin fetch works, and both `/v1/search` and
`/v1/scrape` accept requests with no `Authorization` header). This means the website's search
feature needs **no Claude/Anthropic auth whatsoever** — it's a fully independent path from the
chat workflow above, sharing only the same idea of "role track" tagging.

Its data — API key, listings, "Applied" marks — lives in the visitor's own browser
`localStorage`, never in this repo and never on any server. There is nothing here to keep in
sync from a Claude Code session: the site doesn't read `results.xlsx` or any repo file at
runtime.

**Bridging the two workflows:** if the user ran a search via the chat workflow and wants those
rows on their website board too, the site's "My board" tab has an **Import CSV** button. Export
the relevant `results.xlsx` rows as a CSV (columns: `dateSearched, roleTrack, title, company,
experience, location, applyLink, source, direct, applied`) and hand the user that file to import
— don't try to write into the site's localStorage directly (Claude has no access to the user's
browser storage).

**Working on `site/` itself:** it's plain HTML/CSS/vanilla JS, classic (non-module) `<script>`
tags for maximum portability (works via a local static server or GitHub Pages; ES modules were
avoided in the main app because they don't reliably load over `file://` — `scan.js` is the one
exception, see below, since its feature already requires http(s)). Verify changes with `python3
-m http.server` from inside `site/` before considering a change done — see the `run` skill or
just serve it directly. Keep the Firecrawl API calls in `firecrawl.js` matching the real REST API
(`/v1/search`, `/v1/scrape` with `jsonOptions.schema` for structured extraction) — don't guess at
undocumented parameters; the shapes currently in that file were confirmed against live responses.

**`scan.js` — "Scan my folder":** reads `resumes/*.pdf`/`.docx` and `answers.md`/`questions.md`
straight off the visitor's disk via the File System Access API (`window.showDirectoryPicker()`,
Chromium-only and requires a non-`file:` origin) with a `<input webkitdirectory>` fallback
(one-shot/read-only, but works on any origin including a bare `file://` page — see
`supportsDirectoryPicker()`, which checks `location.protocol` explicitly rather than trusting
feature-detection alone, since Chromium defines `showDirectoryPicker` on `file://` pages but the
call just never resolves there instead of rejecting). Extracts text client-side:
- **PDFs** via `pdf.js` — deliberately pinned to **3.11.174**, the last line with a classic UMD
  build (`pdf.min.js` exposing a `window.pdfjsLib` global); cdnjs only ships `.mjs` builds at
  latest, and dynamic `import()` of a module silently never resolves on a `file://` page the same
  way `showDirectoryPicker` does — same failure shape, same fix (avoid it, don't detect around
  it). Also passes `disableWorker: true` to `getDocument()`: pdf.js's background Worker is loaded
  from a cross-origin (CDN) script URL, which is blocked the same way on `file://`; resumes are a
  page or two, so running extraction on the main thread costs nothing noticeable.
- **`.docx`** via `JSZip` + `DOMParser` on `word/document.xml`'s `<w:t>` runs, mirroring the
  extraction the chat workflow does with Python's `zipfile`/`ElementTree`.

Then it calls Claude's Messages API **directly from the browser** to infer role tracks and map
each resume to one:
- Confirmed live (2026-09-07): `api.anthropic.com` allows direct browser calls, but only with
  the `anthropic-dangerous-direct-browser-access: true` header sent alongside `x-api-key` and
  `anthropic-version` — the OPTIONS preflight returns `access-control-allow-origin: *` only when
  that header is requested; without it, CORS is refused. Same trust model as the Firecrawl key:
  the visitor's own key, sent only to Anthropic, never touching a server of ours.
- Model used: `claude-sonnet-5`. Structured output comes from forcing a tool call
  (`tool_choice: {type:"tool", name:"save_role_tracks"}`) rather than parsing free text — more
  reliable, and the shape lands straight in `content[].input`.
- Nothing is written to `Store` until the visitor reviews the proposed tracks in a modal and
  clicks "Save these tracks" (`Store.mergeTracks`, matched by track name — never silently
  overwrites an unrelated track).
- If asked to extend this (e.g. also scan `results.xlsx`), keep the same shape: extract text
  client-side, truncate per-file before sending (current cap: `MAX_CHARS_PER_FILE` in
  `scan.js`), and always route new data through the same review-before-save modal rather than
  writing to `Store` directly from the analysis step.

## Working notes for future sessions

- Default to the Firecrawl MCP tools already available in this environment for any scraping/search
  task in this directory — don't reach for raw `WebFetch`/`WebSearch` first when the task matches
  the workflow above.
- Always present job/price/catalog results as a single clean table with source links, per the
  doc's convention, **and** log them to `results.xlsx` per the rules above.
- Treat any API keys/tokens for the alternative connectors as secrets; never print or commit them.
- Company career-page search portals are frequently JS-rendered (PeopleSoft, SuccessFactors,
  Workday, etc.) and won't return listings to a plain scrape — expect to fall back to search
  engine results/aggregators for those employers and note that in Source/Notes.

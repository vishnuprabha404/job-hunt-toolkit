# job-hunt-toolkit

A personal job-hunting setup built around [Firecrawl](https://www.firecrawl.dev) — a tool that
lets an AI agent (or your own browser) actually read job listing pages instead of giving up
after one search result.

There are **two ways to run a search**, and they share one board:

1. **From a Claude Code chat** — Claude reads your resume, asks a few questions once, then runs
   searches for you via the Firecrawl MCP connector and logs results to `results.xlsx`.
2. **From the website in `site/`** — a small client-side job board (search box, filters, an
   "Applied" checkbox) that calls Firecrawl's API *directly from your browser*. No backend, no
   Claude account, no sign-in — just an optional free Firecrawl API key.

Both write to the same place conceptually (a list of role / company / experience / location /
apply-link rows); the site can also import a CSV export of `results.xlsx` if you've been running
searches from Claude Code and want them on the board too.

## Quick start — the website

```bash
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

(A plain double-click on `site/index.html` mostly works too, but some browsers restrict local
file requests — serving it, even just for a minute, avoids that entirely.)

1. Click **Settings** → paste a free Firecrawl API key from [firecrawl.dev](https://www.firecrawl.dev)
   (1,000 credits/month, no card). You can also skip this — search still works keyless, just at a
   lower rate limit.
2. Set up your role tracks either way:
   - **Automatically** — paste a Claude API key from [console.anthropic.com](https://console.anthropic.com)
     into Settings, then click **Scan my folder…** on the New Search tab and point it at this
     repo's folder. Claude reads whatever's in `resumes/` (plus `answers.md`/`questions.md` if
     you have them) and proposes role tracks — name, which resume fits each, and sensible
     search defaults — for you to review and save. Works either way you run the site (served via
     `http://localhost` or opened directly as a `file://` page); a Chromium browser (Chrome,
     Edge, Brave) serving it over `http(s)` gets the nicer native folder picker, everything else
     falls back to a plain folder-select dialog that works the same.
   - **Manually** — in Settings, add your role tracks (e.g. "IT Support", "Software Developer")
     and, if you want the reminder, which resume file to use for each.
3. Go to **New search**, fill in role / city / experience / freshness, hit Search.
4. Results land on **My board** — filter by track, mark things "Applied", export/import CSV.

**On the "Scan my folder" feature:** it sends the text of your resume(s) (and `answers.md`/
`questions.md` if present) to Claude's API, using your own key, called directly from your
browser — same trust model as the Firecrawl key: nothing passes through any server of ours.
Everything it proposes lands in a review screen first; nothing is saved until you click "Save
these tracks," and you can edit or remove any row before saving.

Everything (your API keys, your listings, your "Applied" marks) lives in your browser's local
storage. Nothing is sent anywhere except directly to `api.firecrawl.dev` (search) and, only if
you use "Scan my folder," `api.anthropic.com` (resume analysis). Clearing your browser data
clears your board — export a CSV first if you want a backup.

Want it reachable from your phone too, without running a local server? Turn on **GitHub Pages**
for this repo (Settings → Pages → deploy from `main` / `/site`) and open the resulting URL — it's
the same static files, just hosted for you. Your key/listings are still per-browser, not shared
between devices.

## Quick start — the Claude Code chat workflow

See `CLAUDE.md` for the full workflow Claude follows in this repo. Short version:

1. Connect the Firecrawl MCP connector to your Claude account (steps in
   `Claude_x_Firecrawl_Job_Hunting_Workflow.docx`, or ask Claude — it can walk you through it).
2. Copy `answers.example.md` to `answers.md` and fill it in (or drop your resume PDFs into
   `resumes/` and ask Claude to fill it out for you).
3. Ask Claude to run a search for one of your role tracks. It logs results to `results.xlsx`
   (newest search on top) and can push the same rows into the website's board for you.

## What's private vs. what's shared in this repo

This repo is meant to be cloned and reused — a friend can `git clone` it, connect their own
Firecrawl account (chat workflow) or paste their own API key (website), and run the exact same
workflow with their own data. So `.gitignore` keeps personal files out of git entirely:

| File/folder | Committed? | Why |
|---|---|---|
| `site/`, `CLAUDE.md`, `questions.md`, `answers.example.md`, `Claude_x_Firecrawl_Job_Hunting_Workflow.docx` | ✅ | The reusable tool and workflow — no personal data. |
| `answers.md` | ❌ | Your specific answers (target roles, salary floor, etc). |
| `resumes/*` | ❌ | Your actual resume/cover-letter files. |
| `results.xlsx` | ❌ | Your logged search results (Claude-chat workflow). |

Your website data (API key, listings, applied status) never touches git at all — it's browser
local storage, not a file in this repo.

## Repo layout

```
site/                         the standalone job board (open in any browser)
  index.html
  app.js                      UI logic
  store.js                    localStorage persistence
  firecrawl.js                thin wrapper over Firecrawl's REST API
  scan.js                     "Scan my folder": reads resumes/notes off disk, asks Claude's
                               API to infer role tracks (File System Access API + pdf.js/JSZip
                               for text extraction — all client-side)
  styles.css
questions.md                  checklist to work through before searching
answers.example.md            copy to answers.md and fill in (gitignored)
resumes/                      drop your resume PDFs here (gitignored, folder tracked via README)
results.xlsx                  Claude-chat workflow's running log (gitignored)
CLAUDE.md                     instructions Claude follows when working in this repo
Claude_x_Firecrawl_Job_Hunting_Workflow.docx   the original workflow writeup
```

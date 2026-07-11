# BV AWAL Generator

Generates **BV AWAL** ("Backup Volume Awal") Excel workbooks for Indonesian
construction Contract Change Order (CCO) documentation — the audit trail
that proves a planned quantity (Volume Terpasang) was actually derived from
a drawing, not typed in by hand.

Milestone 1: upload a project's Bill of Quantity (BQ) PDF, match uploaded
blueprint images to the parsed work-item list, pick a formula and enter
dimensions, and export one workbook where every Volume Terpasang cell is a
live Excel formula and every entry has its source drawing embedded next to
it.

## Why this exists

Two real project workbooks were reverse-engineered before writing any code
for this system. Both had a genuine backup-calculation defect hiding in
plain sight — a double-counted sub-quantity in one, and two pile-cap types
silently reading each other's formwork source cells in the other (a
~Rp475,000–497,000 swing on two priced line items). Both were only found by
tracing the formula chain by hand. Generating this sheet programmatically,
rather than by manual Excel authoring, removes that entire class of error
by construction.

## Stack

- **Backend:** [Hono](https://hono.dev) on Cloudflare Workers
- **Data:** Cloudflare D1 (structured data), R2 (uploaded PDFs/images and
  generated workbooks)
- **Excel generation:** [ExcelJS](https://github.com/exceljs/exceljs) —
  confirmed working inside the Workers `workerd` runtime (with
  `nodejs_compat`) for both live formulas and embedded images; see
  `spike/` for the isolated verification that de-risked this before the
  rest of the app was built on top of it.
- **PDF parsing:** [unpdf](https://github.com/unjs/unpdf) (PDF.js compiled
  for edge runtimes) for the free deterministic pass; Claude API (native
  PDF input) for the opt-in high-accuracy pass.
- **AI:** Cloudflare Workers AI (free path) and the Claude API (opt-in
  paid path) for dimension suggestion and the pre-export QA pass — see
  "The free-vs-accurate tiering" below.
- **Frontend:** React + Vite, served as static assets from the same Worker.

## Project layout

```
src/worker/          Hono API (Cloudflare Worker)
  routes/             sessions, formulas, entries, export, qa, dimensions
  lib/
    formulas.ts       The 14 predefined RUMUS types -> Excel formula strings
    excelGen.ts        Assembles entries + components into the workbook
    pdfParse.ts        Tier 1 (deterministic) + Tier 3 (Claude API) parsing
src/client/           React frontend
migrations/           D1 schema + formula-library seed data
spike/                Isolated proof that ExcelJS works in the Workers runtime
```

## The free-vs-accurate tiering

Every AI-assisted step has a free default and a paid opt-in — never a
silent fallback that surprises anyone with a cost:

| Step | Free default | Paid opt-in |
|---|---|---|
| BQ PDF -> work items | Deterministic parser + rule-based hierarchy detection (`?mode=free`) | Claude API, native PDF input (`?mode=accurate`, ~$0.05–0.10/doc) |
| Blueprint -> dimensions | Cloudflare Workers AI vision (`?mode=free`) | Claude API vision (`?mode=accurate`) — verified during this project's own analysis to correctly read mm dimension callouts off a real blueprint crop |
| Pre-export QA pass | Deterministic checks always run for free (blank required fields, duplicate dimension sets across items) | Claude API contextual review layered on top, if `ANTHROPIC_API_KEY` is configured |

Dimension suggestions are **always** a suggestion — the frontend pre-fills
an editable form and requires explicit confirmation before an entry is
submitted. This is deliberate: it's financial/contractual data, and a wrong
auto-filled number accepted silently is worse than no automation.

## Local development

```bash
npm install

# Apply the schema + seed the formula library to a local D1 file
npm run db:migrate:local
npx wrangler d1 execute bv_awal_db --local --file=migrations/0002_seed_formulas.sql

npm run dev
```

`npm run dev` builds the client once and starts `wrangler dev`, which runs
the real Workers runtime locally (D1 and R2 are emulated; Cloudflare
Workers AI requires a real Cloudflare connection — see below).

The paid opt-in paths need an Anthropic API key:

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY
wrangler secret put ANTHROPIC_API_KEY --local
```

**Note on `wrangler dev` and the `AI` binding:** Workers AI has no local
emulation — it always proxies to Cloudflare, which means `wrangler dev`
needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`) even for local-only
testing of the free dimension-suggestion path. Every other route (BQ
upload/parsing, entries, export, QA's deterministic checks) works fully
offline with no Cloudflare account at all.

## Deployment

1. `wrangler login`
2. `wrangler d1 create bv_awal_db` — copy the returned `database_id` into
   `wrangler.toml`
3. `wrangler r2 bucket create bv-awal-files`
4. `npm run db:migrate:remote` and run the formula-seed migration with
   `--remote`
5. `wrangler secret put ANTHROPIC_API_KEY` (optional — only needed for the
   paid opt-in paths)
6. `npm run deploy`, or push to `main` and let `.github/workflows/deploy.yml`
   do it — set the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   repository secrets first.

## Known gaps in this pass (Milestone 1, not yet complete)

- The free-tier PDF parser is intentionally not perfect — see the doc
  comment in `pdfParse.ts`. Real-world test against an actual BQ PDF
  (7 pages, 153 work items) parsed the hierarchy and item numbering
  correctly; a few dash-bulleted descriptive sub-lines (component lists
  under a single item, e.g. "Sofa Custom 1 Unit" under "Sofa Lounge Set")
  were misclassified as standalone items. This is exactly the kind of
  case Tier 3 (Claude API) exists to catch — it hasn't been benchmarked
  against this same document yet.
- The Cloudflare Workers AI model used for the free dimension-suggestion
  path (`@cf/llava-hf/llava-1.5-7b-hf`) should be re-verified against the
  current Workers AI model catalog before relying on it — that catalog
  changes.
- No auth/multi-tenancy — single-session tool for now (see the open
  questions in the project's PRD brief).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Glazing Extractor — uploads an architectural PDF, calls Claude's vision API to extract window/door specifications, and returns a pre-filled NCC 2022 glazing calculator spreadsheet (.xlsx).

## Development Commands

```bash
npm install                        # install dependencies
netlify dev                        # local dev server at http://localhost:8888
netlify deploy --build --prod      # production deploy
```

No test suite or linter is configured.

## Required Environment Variable

`ANTHROPIC_API_KEY` — must be set in Netlify environment (not committed to repo).

## Architecture

```
public/index.html          → SPA frontend (vanilla JS, drag-and-drop PDF upload)
netlify/functions/
  extract-glazing.js       → ACTIVE: Node.js Netlify Function (main backend)
netlify/edge-functions/
  extract-glazing.js       → earlier Deno edge function (v2 prompt)
  anthropic-proxy.js       → most advanced Deno edge function (v3 prompt, not deployed)
public/glazing-template.xlsx → NCC 2022 Excel template (bundled via netlify.toml)
```

**Request flow:**
1. Frontend base64-encodes the PDF and POSTs `{pdfBase64, filename}` to `/.netlify/functions/extract-glazing`
2. Function sends the PDF to Claude (`claude-sonnet-4-20250514`) with a structured extraction prompt
3. Claude returns JSON array of glazing elements
4. Function loads `glazing-template.xlsx`, writes extracted data into rows 20–99 (max 80 windows), returns the filled xlsx as base64
5. Frontend triggers browser download of the resulting file

**Spreadsheet columns populated (rows 20–99):**
- D: Description (window/door code + room)
- F: Facing (N/NE/E/SE/S/SW/W/NW)
- G: Height (metres, 2 dp)
- H: Width (metres, 2 dp)
- J: Room type (Bedroom/Utility/Other)
- M: Frame colour (Dark/Medium/Light)

Users must manually complete U-Value, SHGC, Operability, and Floor type columns after download.

## AI Prompt Versions

Three prompt iterations exist across the backend files; the one in `netlify/functions/extract-glazing.js` is what Netlify deploys. The edge-function versions (`anthropic-proxy.js` in particular) contain more sophisticated extraction logic (scope determination, deduplication, confidence scoring, colour-name mapping) that can be referenced if the active prompt needs improvement.

## Notable Constraints

- Spreadsheet only supports 80 glazing elements (rows 20–99); larger projects are silently truncated.
- `glazing-template.xlsx` must be included in the function bundle — this is handled by `included_files` in `netlify.toml`.
- The folder structure is nested (`glazing-pipeline/glazing-pipeline/`); the inner folder is the actual deployable project root.

const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHUNK_PROMPT = (chunkNum, totalChunks) => `You are an Australian residential glazing extraction engine for NCC 2022 energy assessments.

You are processing CHUNK ${chunkNum} of ${totalChunks} from a set of architectural plans.
Extract every window and glazed door visible in these pages.

STRICT RULES:
- Only extract information explicitly visible in these pages
- Return VALID JSON ONLY — no markdown, no explanation
- If information is not visible, return ""

EXTRACT FROM THESE PAGES:
1. Window/door SCHEDULE TABLE — highest priority if present
2. FLOOR PLAN tags — check every room, every wall
3. ELEVATION DRAWINGS — note the elevation title for facing direction

FOR EACH WINDOW:
- window_id: tag code exactly as written (e.g. "ASD 21-36")
- room_name: room label from floor plan
- facing: elevation label gives facing — "NORTH-EAST ELEVATION" = NE. Leave "" if uncertain
- height_m: first number in tag code = height (ASW 15-18 = H:1.5m). Convert to metres
- width_m: second number in tag code = width (ASW 15-18 = W:1.8m). Convert to metres
- room_type: "Bedroom" | "Utility" | "Other"
- opening_type: from tag prefix — ASD=Sliding Door, ASW=Sliding Window, AFW=Fixed Window, AAW=Awning Window
- frame_colour: "Dark"|"Medium"|"Light"|"" — window frame only, not roof or cladding
- confidence: "High"|"Medium"|"Low"
- source_page: page number in this chunk
- notes: any relevant detail

ALSO NOTE if you see:
- GFA area figures on a site plan (e.g. "EXISTING 100m²", "NEW WORKS 69m²")
- North arrow direction
- Any scope notes about new works vs existing

OUTPUT — VALID JSON ONLY:
{
  "chunk": ${chunkNum},
  "gfa_notes": "any GFA figures seen on these pages",
  "north_arrow": "direction north arrow points if visible",
  "windows": [
    {
      "window_id": "",
      "room_name": "",
      "facing": "",
      "height_m": "",
      "width_m": "",
      "room_type": "",
      "opening_type": "",
      "frame_colour": "",
      "confidence": "",
      "source_page": "",
      "notes": ""
    }
  ]
}`;

const SCOPE_PROMPT = (chunkResults) => `You are an NCC 2022 energy assessment scope determiner.

Review these GFA notes extracted from architectural plans and determine the correct assessment scope.

CHUNK DATA:
${JSON.stringify(chunkResults.map(c => ({ chunk: c.chunk, gfa_notes: c.gfa_notes, north_arrow: c.north_arrow })), null, 2)}

SCOPE RULE:
- New works GFA < 50% of existing residence GFA = NEW WORKS only
- New works GFA >= 50% of existing residence GFA = WHOLE DWELLING
- New dwelling = WHOLE DWELLING
- IMPORTANT: Exclude garages, carports, sheds, decks, alfresco from GFA calculation

Return VALID JSON ONLY:
{
  "scope": "new_works_only" | "whole_dwelling",
  "scope_note": "brief explanation with GFA figures used",
  "existing_gfa": number_or_null,
  "new_works_gfa": number_or_null
}`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function extractChunk(pages, chunkNum, totalChunks) {
  const imageContents = [];
  for (let i = 0; i < pages.length; i++) {
    const imgResponse = await fetch(pages[i]);
    const imgBuffer = await imgResponse.arrayBuffer();
    const imgBase64 = Buffer.from(imgBuffer).toString("base64");
    imageContents.push({ type: "text", text: `--- PAGE ${i + 1} ---` });
    imageContents.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: imgBase64 },
    });
  }
  imageContents.push({ type: "text", text: CHUNK_PROMPT(chunkNum, totalChunks) });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: "You are a data extraction assistant. Respond with valid JSON only.",
    messages: [{ role: "user", content: imageContents }],
  });

  const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { pdfUrl, filename } = body;

    console.log("Received body keys:", Object.keys(body));
    console.log("pdfUrl present:", !!pdfUrl);
    console.log("filename:", filename);

    if (!pdfUrl) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "No PDF URL provided", received: Object.keys(body) }),
      };
    }

    const pdfcoKey = process.env.PDFCO_API_KEY;

    // ── STEP 1: Convert PDF to PNG images via PDF.co ──
    const convertResponse = await fetch("https://api.pdf.co/v1/pdf/convert/to/png", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": pdfcoKey },
      body: JSON.stringify({ url: pdfUrl, dpi: 96, async: true }),
    });
    const convertInit = await convertResponse.json();
    console.log("PDF.co init jobId:", convertInit.jobId);

    let pageUrls = [];
    if (convertInit.urls && convertInit.urls.length > 0) {
      pageUrls = convertInit.urls;
    } else if (convertInit.jobId) {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollResponse = await fetch(`https://api.pdf.co/v1/job/check?jobid=${convertInit.jobId}`, {
          headers: { "x-api-key": pdfcoKey },
        });
        const pollData = await pollResponse.json();
        console.log(`Poll ${i + 1}: ${pollData.status}`);
        if (pollData.status === "success") {
          const resultJsonResponse = await fetch(pollData.url);
          pageUrls = await resultJsonResponse.json();
          break;
        }
        if (pollData.status === "error") {
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ error: "PDF.co job failed", detail: pollData.message }),
          };
        }
      }
    }

    if (pageUrls.length === 0) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "PDF.co returned no pages" }),
      };
    }

    console.log("Total pages:", pageUrls.length);

    // ── STEP 2: Split into chunks and process in parallel ──
    const CHUNK_SIZE = 8;
    const chunks = chunkArray(pageUrls, CHUNK_SIZE);
    console.log(`Processing ${chunks.length} chunks of ~${CHUNK_SIZE} pages in parallel`);

    const chunkResults = await Promise.all(
      chunks.map((pages, i) => extractChunk(pages, i + 1, chunks.length))
    );

    console.log("All chunks complete, total raw windows:", chunkResults.reduce((sum, c) => sum + (c.windows || []).length, 0));

    // ── STEP 3: Determine scope from GFA notes ──
    const scopeResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: "You are a data assistant. Respond with valid JSON only.",
      messages: [{ role: "user", content: SCOPE_PROMPT(chunkResults) }],
    });
    const scopeRaw = scopeResponse.content.filter(b => b.type === "text").map(b => b.text).join("");
    const scopeCleaned = scopeRaw.replace(/```json|```/g, "").trim();
    const scopeMatch = scopeCleaned.match(/\{[\s\S]*\}/);
    const scopeResult = JSON.parse(scopeMatch ? scopeMatch[0] : scopeCleaned);
    console.log("Scope determined:", scopeResult.scope, scopeResult.scope_note);

    // ── STEP 4: Collect all windows, apply scope filter ──
    let allWindows = [];
    for (const chunk of chunkResults) {
      if (chunk.windows) allWindows = allWindows.concat(chunk.windows);
    }

    // Filter by scope — existing windows tagged "e-" are excluded for new_works_only
    if (scopeResult.scope === "new_works_only") {
      allWindows = allWindows.filter(w => {
        const id = (w.window_id || "").toLowerCase();
        return !id.startsWith("e-") && !id.startsWith("e ");
      });
    }

    // ── STEP 5: Merge and deduplicate ──
    const mergedMap = new Map();
    const normalise = (str) => (str || "").toLowerCase().replace(/\s+/g, "").replace(/[-_]/g, "").trim();

    for (const win of allWindows) {
      const key = normalise(win.window_id) +
                  "|" + String(win.height_m || "") +
                  "|" + String(win.width_m || "") +
                  "|" + normalise(win.room_name);

      if (!mergedMap.has(key)) {
        mergedMap.set(key, { ...win });
      } else {
        const existing = mergedMap.get(key);
        for (const field of Object.keys(win)) {
          if (!existing[field] && win[field]) existing[field] = win[field];
        }
        if (win.source_page && existing.source_page && win.source_page !== existing.source_page) {
          const pages = new Set([...String(existing.source_page).split(","), ...String(win.source_page).split(",")]);
          existing.source_page = Array.from(pages).sort().join(",");
        }
        if (win.notes && existing.notes && win.notes !== existing.notes) {
          existing.notes = existing.notes + "; " + win.notes;
        }
      }
    }

    const schedule = Array.from(mergedMap.values()).sort((a, b) =>
      (a.window_id || "").toLowerCase().localeCompare((b.window_id || "").toLowerCase())
    );

    console.log("Final schedule count:", schedule.length);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        filename: (filename || "plans").replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]/gi, "_") + "_glazing",
        elements: schedule,
        element_count: schedule.length,
        scope_note: scopeResult.scope_note || "",
        page_count: pageUrls.length,
        chunk_count: chunks.length,
      }),
    };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

const EXTRACTION_PROMPT = `You are an Australian residential glazing extraction engine for NCC 2022 energy assessments.

Extract every window and glazed door from these architectural plans.

STRICT RULES:
- Do NOT infer or guess any values
- Do NOT estimate dimensions from drawing scale
- Only extract information explicitly visible in the drawings
- If information is not visible, return ""
- Return VALID JSON ONLY — no markdown, no explanation

STEP 1 — IDENTIFY DOCUMENT CONTENTS
Scan every page and identify:
- Window/door schedule table (HIGHEST PRIORITY source)
- Floor plans with window tags
- Elevation drawings and their labels
- North arrow location and direction
- Whether this is a new dwelling or addition/extension to existing

STEP 2 — DETERMINE SCOPE
If plans show both new works AND existing dwelling:
- Calculate habitable residence GFA only (exclude garages, carports, sheds, decks)
- New works GFA shown on site plan with area label
- Existing windows often tagged with "e-" or "E-" prefix
- If new works GFA < 50% of existing residence GFA: extract NEW WORKS windows only
- If new works GFA >= 50% of existing residence GFA: extract ALL windows
- If brand new dwelling: extract ALL windows

STEP 3 — EXTRACT FROM WINDOW SCHEDULE FIRST
If a window schedule table exists, extract directly from it.
Schedule headings may include: Window ID, Width, Height, Type, Frame, Colour, Notes.
This is the most reliable source — always prefer it over other sources.

STEP 4 — EXTRACT FROM FLOOR PLANS
For each room in scope, check every wall for window and door tags.
The same tag code can appear on multiple walls in different rooms — each is a separate entry.
Sliding doors (ASD tags) are always glazing elements — do not skip them.

STEP 5 — ASSIGN FACING DIRECTION
Only assign facing if you can confirm it from ONE of these sources:

SOURCE A — ELEVATION LABEL (most reliable):
Find the window tag on an elevation drawing.
Note the PAGE NUMBER that elevation drawing is on.
The elevation title is the facing: "NORTH-EAST ELEVATION" = NE, "SOUTH ELEVATION" = S, etc.
Only assign if this tag appears on ONE elevation only.
If same tag appears on multiple elevations: return "".

SOURCE B — NORTH ARROW + WALL POSITION:
1. Find the north arrow on the floor plan — note which direction it points
2. Note the PAGE NUMBER the floor plan is on
3. Identify which wall of the room the window sits on (top/bottom/left/right of plan)
4. That wall faces the compass direction aligned with the north arrow

Example: North arrow points top-right (NE):
- Top wall = NE, Right wall = SE, Bottom wall = SW, Left wall = NW

Many Australian houses are rotated 45° — check the north arrow carefully.
If north arrow points diagonally, all facings will be diagonal (NE/SE/SW/NW).
If orientation cannot be determined confidently: return ""

ALWAYS record the source page number for every window — this is critical for accuracy verification.

STEP 6 — DIMENSIONS
Priority order:
1. Window/door schedule table
2. Dimension strings on elevation drawing
3. Tag code decoding ONLY if schedule or legend confirms 100mm increment format
   ASW 12-9 = H:1.2m x W:0.9m | ASD 21-36 = H:2.1m x W:3.6m | AFW 06-35 = H:0.6m x W:3.5m
   First number = height, second number = width

Convert all dimensions to metres with 2 decimal places.
If dimensions cannot be confirmed: return ""

STEP 7 — FRAME COLOUR
Extract WINDOW FRAME colour only — not roof, wall cladding, fascia, or gutter colour.
Look ONLY in:
- Window/door schedule "Finish" or "Colour" column
- Elevation note specifically saying "WINDOWS AND DOORS COLOUR: ..."

Map to: "Dark" | "Medium" | "Light"
- Woodland Grey, Ironstone, Monument, Basalt, Black, Dark Bronze = Dark
- Surfmist, Paperbark, Classic Cream, White, Pearl White = Light
- Shale Grey, Windspray, Dune = Medium
If not explicitly stated for windows/doors: return ""

STEP 8 — OPENING TYPE
Extract from tag prefix:
- ASD, SD = Sliding Door
- ASW, SW = Sliding Window
- AFW, FW, FX = Fixed Window
- AAW, AW = Awning Window
- ACW, CW = Casement Window
Only expand abbreviations if confirmed in schedule legend.

OUTPUT — return VALID JSON ONLY:
{
  "scope_note": "brief note on new works vs existing decision and GFA figures used",
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
}

FIELD RULES:
- window_id: tag code exactly as written (e.g. "ASD 21-36", "W01")
- room_name: room label from floor plan
- facing: N | NE | E | SE | S | SW | W | NW | "" (blank if uncertain)
- height_m: number in metres or ""
- width_m: number in metres or ""
- room_type: "Bedroom" | "Utility" | "Other"
  Bedroom = bedroom, ensuite, walk-in robe
  Utility = bathroom, WC, laundry, powder room
  Other = living, dining, kitchen, lounge, family, study, hall, alfresco
- opening_type: Sliding Door | Sliding Window | Fixed Window | Awning Window | Casement Window | ""
- frame_colour: "Dark" | "Medium" | "Light" | ""
- confidence: "High" | "Medium" | "Low"
  High = all fields confirmed from explicit sources
  Medium = one field inferred or tag code decoded without confirmed legend
  Low = multiple fields uncertain
- source_page: page number where this window was found (e.g. "4" or "2,4" if on multiple pages)
- notes: any relevant uncertainty or source reference`;


export default async function handler(request, context) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { pdfBase64, filename } = body;

    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "No PDF provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

    // ── CALL 1: Extract raw glazing data from PDF ──
    const extractResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: "You are a data extraction assistant. You always respond with valid JSON only. Never include explanations or text outside the JSON structure.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!extractResponse.ok) {
      const errText = await extractResponse.text();
      return new Response(JSON.stringify({ error: "Claude API error on extraction", detail: errText }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const extractData = await extractResponse.json();
    const rawText = extractData.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse extraction result
    let extractedResult;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      extractedResult = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Could not parse extraction result", raw: rawText.substring(0, 500) }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ── STEP 2: Merge and deduplicate in JavaScript ──
    const rawWindows = extractedResult.windows || [];
    const mergedMap = new Map();

    for (const win of rawWindows) {
      const key = (win.window_id || win.description || "").trim().toLowerCase() +
                  "|" + (win.room_name || "").trim().toLowerCase();

      if (!mergedMap.has(key)) {
        mergedMap.set(key, { ...win });
      } else {
        const existing = mergedMap.get(key);
        // Merge: fill in any empty fields from this record
        for (const field of Object.keys(win)) {
          if (!existing[field] && win[field]) {
            existing[field] = win[field];
          }
        }
        // Combine notes
        if (win.notes && existing.notes && win.notes !== existing.notes) {
          existing.notes = existing.notes + "; " + win.notes;
        }
      }
    }

    // Sort by window_id ascending
    const schedule = Array.from(mergedMap.values()).sort((a, b) => {
      const idA = (a.window_id || a.description || "").toLowerCase();
      const idB = (b.window_id || b.description || "").toLowerCase();
      return idA.localeCompare(idB);
    });

    return new Response(
      JSON.stringify({
        success: true,
        filename: (filename || "plans").replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]/gi, "_") + "_glazing",
        elements: schedule,
        element_count: schedule.length,
        scope_note: extractedResult.scope_note || "",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/anthropic-proxy" };

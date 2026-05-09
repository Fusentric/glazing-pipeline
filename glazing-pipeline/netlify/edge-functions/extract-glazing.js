const EXTRACTION_PROMPT = `You are an expert NCC 2022 energy assessor. Your task is to extract every glazing element from these architectural plans with 95%+ accuracy and return a JSON array.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — SCAN THE ENTIRE DOCUMENT FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before extracting anything, read through ALL pages and identify:
1. The compass rose / north point on the floor plan (this tells you true north orientation)
2. The window/door schedule or legend (contains codes like ASW, AFW, ASD, W01 etc. with dimensions)
3. All elevation drawings (labelled NORTH ELEVATION, SOUTH ELEVATION, etc.)
4. All floor plans (ground floor, upper floor, alfresco, etc.)
5. Any section drawings showing window heights

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — BUILD YOUR COMPLETE WINDOW LIST FROM FLOOR PLANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The floor plan is your MASTER SOURCE for completeness. Go room by room:
- List every room on the floor plan (e.g. Bedroom 1, Kitchen, Living, Alfresco, WC, Ensuite, Laundry, etc.)
- For each room, list every window/door tag shown on that floor plan
- Note the wall each window is on (which wall of that room does it sit in?)
- Do NOT skip any room. Missing rooms = missed glazing elements.

Common mistake to avoid: Assessors often find windows in Living areas but miss windows in Kitchen, Alfresco, Hallway, or upper floor rooms. Check every room systematically.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — DETERMINE FACING FROM ELEVATION DRAWINGS ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULE: Facing direction MUST come from the elevation drawing label only.
- A window shown on the drawing labelled "NORTH ELEVATION" faces NORTH (N)
- A window shown on the drawing labelled "SOUTH ELEVATION" faces SOUTH (S)
- A window shown on the drawing labelled "EAST ELEVATION" faces EAST (E)
- A window shown on the drawing labelled "WEST ELEVATION" faces WEST (W)
- For diagonal orientations (NE, SE, SW, NW): only assign if the elevation is explicitly labelled as such

DO NOT determine facing from:
- The compass rose on the floor plan
- The position of the window on the floor plan
- Your assumption about which way the house faces

If you cannot find a window tag on any elevation drawing, leave facing as "TBC" and note it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — DIMENSIONS: USE SCHEDULE/LEGEND FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dimension priority (use the first source that gives you a clear value):
1. Window/door SCHEDULE table (most reliable — lists tag codes with H x W dimensions)
2. Dimension strings on the elevation drawing next to that specific window
3. Tag code decoding if a legend is provided (e.g. ASW 21-18 = 2100mm H x 1800mm W = 2.1m x 1.8m)

Tag code decoding rule (Alspec/AWS style): The numbers after the type code are HEIGHT-WIDTH in 100mm increments.
Examples: ASW 21-18 = 2.1m x 1.8m | AFW 06-35 = 0.6m x 3.5m | ASD 21-35 = 2.1m x 3.5m

Always convert mm to metres (divide by 1000). Report to 2 decimal places.
If dimensions genuinely cannot be found, use "TBC" — do not guess.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — FRAME COLOUR: WINDOW FRAME ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Frame colour refers to the WINDOW FRAME colour only — not the roof, cladding, or any other finish.

Look specifically for:
- Window schedule column labelled "Finish", "Colour", or "Frame Colour"
- Notes on elevation drawings specifying window frame colour
- Specifications section mentioning window frame finish

Colour mapping:
- Jasper, Woodland Grey, Ironstone, Monument, Basalt, Black, Dark Bronze → "Dark"
- Surfmist, Paperbark, Classic Cream, White, Pearl White → "Light"
- Shale Grey, Windspray, Dune → "Medium"

CRITICAL: Do NOT use Colorbond roof colours, cladding colours, or fascia colours as the frame colour.
If frame colour is genuinely not specified for the windows, use "TBC".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6 — COUNT INSTANCES CORRECTLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If the same window tag appears 3 times on a floor plan = 3 separate entries in your output.
If the same tag appears on both floor plan and elevation = it is ONE window (the elevation just shows it from outside).
Each physical window/door pane = one entry, even if they share the same product code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD DEFINITIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "description": The window/door code from plans + room name if identifiable (e.g. "ASD 21-18 Living" or "W01 Bedroom 2")
- "facing": N | NE | E | SE | S | SW | W | NW | "TBC"
- "height_m": Number in metres, or "TBC"
- "width_m": Number in metres, or "TBC"
- "room_type": Exactly one of:
    "Bedroom" — bedrooms, ensuite, robe (if attached to bedroom)
    "Utility" — bathroom, WC, laundry, toilet, powder room
    "Other" — living, dining, kitchen, lounge, family, study, hall, alfresco, garage, office
- "frame_colour": "Dark" | "Medium" | "Light" | "TBC"

Do NOT fill in or guess: U-Value, SHGC, openability, floor type.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Respond with ONLY a valid JSON array. No markdown, no explanation, no preamble:
[
  {
    "description": "string",
    "facing": "N|NE|E|SE|S|SW|W|NW|TBC",
    "height_m": number_or_"TBC",
    "width_m": number_or_"TBC",
    "room_type": "Bedroom|Utility|Other",
    "frame_colour": "Dark|Medium|Light|TBC"
  }
]`;

export default async function handler(request, context) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response("", {
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

    // Call Anthropic API directly from edge function
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY"),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
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

    const anthropicData = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      return new Response(JSON.stringify({ error: anthropicData.error?.message || "Anthropic API error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const rawText = anthropicData.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse the JSON from Claude
    let glazingElements;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      glazingElements = JSON.parse(cleaned);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Could not parse glazing data", raw: rawText.substring(0, 500) }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Return the elements — frontend will build the spreadsheet
    const outFilename = (filename || "plans")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9_-]/gi, "_");

    return new Response(
      JSON.stringify({
        success: true,
        filename: outFilename,
        element_count: glazingElements.length,
        elements: glazingElements,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}

export const config = { path: "/extract-glazing" };

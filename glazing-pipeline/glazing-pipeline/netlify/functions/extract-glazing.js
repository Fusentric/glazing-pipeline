const Anthropic = require("@anthropic-ai/sdk");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are an expert energy assessor analysing architectural PDF plans for an NCC 2022 glazing calculator.

Your task: Extract every window, door, and skylight from these plans and return a JSON array.

For each glazing element, extract:
- "description": Window/door code or label from the plans (e.g. "W01", "D02", "ASW 13-12"). Use the room name + code if available.
- "facing": Cardinal direction the glazing faces. Must be one of: N, NE, E, SE, S, SW, W, NW. Determine from the elevation drawings (North elevation = windows face North, etc.).
- "height_m": Height in metres (convert from mm if needed)
- "width_m": Width in metres (convert from mm if needed)
- "room_type": One of exactly: "Bedroom", "Utility", "Other". Use "Bedroom" for bedrooms and ensuites. Use "Utility" for bathrooms, laundries, WCs. Use "Other" for living, dining, kitchen, hall, study.
- "frame_colour": One of exactly: "Dark", "Medium", "Light". If not specified in plans, use "TBC".

Do NOT extract or guess:
- U-Value (leave blank)
- SHGC (leave blank)
- Operability/opening type (leave blank)
- Floor type (leave blank)

Rules:
- Group identical windows on the same elevation together as separate entries (one per window)
- If a window appears on multiple elevations, only list it once
- For sliding doors, treat as a glazing element
- For skylights, use "Horizontal" as facing — actually use "N" for skylights (approximation)
- Convert all dimensions to metres with 2 decimal places
- If height or width cannot be determined, use "TBC"

Respond with ONLY a valid JSON array, no other text, no markdown:
[
  {
    "description": "string",
    "facing": "N|NE|E|SE|S|SW|W|NW",
    "height_m": number_or_"TBC",
    "width_m": number_or_"TBC",
    "room_type": "Bedroom|Utility|Other",
    "frame_colour": "Dark|Medium|Light|TBC"
  }
]`;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { pdfBase64, filename } = body;

    if (!pdfBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "No PDF provided" }),
      };
    }

    // Step 1: Send PDF to Claude for extraction
    console.log("Sending PDF to Claude for glazing extraction...");
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
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
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Step 2: Parse extracted JSON
    let glazingElements;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      glazingElements = JSON.parse(cleaned);
    } catch (e) {
      console.error("Failed to parse Claude response:", rawText);
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({
          error: "Could not parse glazing data from plans",
          raw: rawText.substring(0, 500),
        }),
      };
    }

    // Step 3: Load the glazing template spreadsheet
    const templatePath = path.join(
      __dirname,
      "../../public/glazing-template.xlsx"
    );
    const workbook = XLSX.readFile(templatePath, { cellFormula: true, cellStyles: true });
    const ws = workbook.Sheets["Calculator"];

    // Step 4: Fill in the glazing data starting at row 20
    // Column mapping (1-indexed → Excel letter):
    // D=4: Description, F=6: Facing, G=7: Height, H=8: Width
    // J=10: Room type, M=13: Frame colour
    // Unfilled: K=11 (Floor type), N=14 (Openability), O=15 (U-value), P=16 (SHGC)

    const COL = {
      description: "D",
      facing: "F",
      height: "G",
      width: "H",
      room_type: "J",
      frame_colour: "M",
    };

    glazingElements.forEach((el, i) => {
      const row = 20 + i;
      if (row > 99) return; // Calculator only supports rows 20-99

      const setCellValue = (col, value) => {
        const cellRef = `${col}${row}`;
        ws[cellRef] = { v: value, t: typeof value === "number" ? "n" : "s" };
      };

      setCellValue(COL.description, el.description || "TBC");
      setCellValue(COL.facing, el.facing || "TBC");
      setCellValue(COL.height, typeof el.height_m === "number" ? el.height_m : "TBC");
      setCellValue(COL.width, typeof el.width_m === "number" ? el.width_m : "TBC");
      setCellValue(COL.room_type, el.room_type || "TBC");
      setCellValue(COL.frame_colour, el.frame_colour || "TBC");
    });

    // Step 5: Write workbook to buffer
    const outputBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const base64Output = outputBuffer.toString("base64");
    const outFilename = (filename || "plans")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9_-]/gi, "_");

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        filename: `${outFilename}_glazing.xlsx`,
        xlsx_base64: base64Output,
        element_count: glazingElements.length,
        elements: glazingElements,
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

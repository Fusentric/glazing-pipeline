// Background function — runs async, stores result in a temp file via env
// Browser polls /check-result?id=xxx to get the output
const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const https = require("https");
const http = require("http");

const CHUNK_PROMPT = (chunkNum, totalChunks) => `You are an Australian residential glazing extraction engine for NCC 2022 energy assessments.

You are processing CHUNK ${chunkNum} of ${totalChunks} from a set of architectural plans.
Extract every window and glazed door visible in these pages.

STRICT RULES:
- Only extract information explicitly visible in these pages
- Return VALID JSON ONLY — no markdown, no explanation
- If information is not visible, return ""

FOR EACH WINDOW FOUND:
- window_id: tag code exactly as written (e.g. "ASD 21-36")
- room_name: room label from floor plan
- facing: elevation title gives facing — "NORTH-EAST ELEVATION"=NE, "SOUTH ELEVATION"=S. Leave "" if uncertain
- height_m: first number in tag code = height in metres (ASW 15-18 = 1.5m)
- width_m: second number in tag code = width in metres (ASW 15-18 = 1.8m)
- room_type: "Bedroom"|"Utility"|"Other"
- opening_type: ASD=Sliding Door, ASW=Sliding Window, AFW=Fixed Window, AAW=Awning Window
- frame_colour: "Dark"|"Medium"|"Light"|"" — window frame only
- confidence: "High"|"Medium"|"Low"
- source_page: page number in this chunk
- notes: any relevant detail

ALSO NOTE any GFA figures or north arrow direction visible.

OUTPUT — VALID JSON ONLY:
{
  "chunk": ${chunkNum},
  "gfa_notes": "any GFA area figures seen",
  "north_arrow": "direction if visible",
  "windows": []
}`;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function extractChunk(pages, chunkNum, totalChunks) {
  const imageContents = [];
  for (let i = 0; i < pages.length; i++) {
    const imgBuffer = await fetchUrl(pages[i]);
    const imgBase64 = imgBuffer.toString("base64");
    imageContents.push({ type: "text", text: `--- PAGE ${i + 1} ---` });
    imageContents.push({ type: "image", source: { type: "base64", media_type: "image/png", data: imgBase64 } });
  }
  imageContents.push({ type: "text", text: CHUNK_PROMPT(chunkNum, totalChunks) });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: "You are a data extraction assistant. Respond with valid JSON only.",
    messages: [{ role: "user", content: imageContents }],
  });

  const raw = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const { pdfUrl, filename, jobId } = body;
  const pdfcoKey = process.env.PDFCO_API_KEY;

  console.log("Background job started:", jobId, filename);

  try {
    // Convert PDF to images
    const convertRes = await fetch("https://api.pdf.co/v1/pdf/convert/to/png", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": pdfcoKey },
      body: JSON.stringify({ url: pdfUrl, dpi: 96, async: true }),
    });
    const convertInit = await convertRes.json();

    let pageUrls = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.pdf.co/v1/job/check?jobid=${convertInit.jobId}`, {
        headers: { "x-api-key": pdfcoKey },
      });
      const pollData = await pollRes.json();
      if (pollData.status === "success") {
        const resultJson = await (await fetch(pollData.url)).json();
        pageUrls = resultJson;
        break;
      }
    }

    // Parallel chunk extraction
    const chunks = chunkArray(pageUrls, 8);
    const chunkResults = await Promise.all(chunks.map((p, i) => extractChunk(p, i + 1, chunks.length)));

    // Merge windows
    let allWindows = chunkResults.flatMap(c => c.windows || []);
    const normalise = str => (str || "").toLowerCase().replace(/\s+/g, "").replace(/[-_]/g, "").trim();
    const mergedMap = new Map();

    for (const win of allWindows) {
      const key = normalise(win.window_id) + "|" + String(win.height_m || "") + "|" + String(win.width_m || "") + "|" + normalise(win.room_name);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, { ...win });
      } else {
        const existing = mergedMap.get(key);
        for (const f of Object.keys(win)) { if (!existing[f] && win[f]) existing[f] = win[f]; }
      }
    }

    const schedule = Array.from(mergedMap.values()).sort((a, b) => (a.window_id || "").localeCompare(b.window_id || ""));
    const gfaNotes = chunkResults.map(c => c.gfa_notes).filter(Boolean).join("; ");

    // Store result in Netlify Blobs
    const { getStore } = require("@netlify/blobs");
    const store = getStore({
      name: "glazing-results",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    await store.setJSON(jobId, {
      success: true,
      filename: (filename || "plans").replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]/gi, "_") + "_glazing",
      elements: schedule,
      element_count: schedule.length,
      scope_note: gfaNotes,
      page_count: pageUrls.length,
    });

    console.log("Background job complete:", jobId, "windows:", schedule.length);
  } catch (err) {
    console.error("Background job error:", err);
    const { getStore } = require("@netlify/blobs");
    const store = getStore({
      name: "glazing-results",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    await store.setJSON(jobId, { error: err.message });
  }
};

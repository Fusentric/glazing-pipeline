exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "No jobId" }) };

  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore({
      name: "glazing-results",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });
    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      return { statusCode: 202, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ status: "pending" }) };
    }

    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ status: "complete", ...result }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};

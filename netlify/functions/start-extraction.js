const crypto = require("crypto");

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };

  const body = JSON.parse(event.body || "{}");
  const jobId = crypto.randomUUID();

  // Fire background function
  const bgUrl = `${process.env.URL}/.netlify/functions/extract-glazing-background`;
  fetch(bgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, jobId }),
  }).catch(err => console.error("Background trigger error:", err));

  // Return job ID immediately
  return {
    statusCode: 202,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, status: "started" }),
  };
};

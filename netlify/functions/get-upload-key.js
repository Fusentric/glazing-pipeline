function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  return {
    statusCode: 200,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ key: process.env.PDFCO_API_KEY }),
  };
};

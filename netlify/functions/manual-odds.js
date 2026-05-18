const { isSupabaseConfigured, runSupabaseAction } = require("./supabase-ledger");

exports.handler = async (event) => {
  if (!isSupabaseConfigured()) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use manual odds." })
    };
  }

  try {
    const payload = event.httpMethod === "GET"
      ? { eventId: event.queryStringParameters?.eventId || "" }
      : JSON.parse(event.body || "{}");
    const action = payload.action || (event.httpMethod === "GET" ? "getManualOdds" : "");
    const result = await runSupabaseAction(action, payload);
    return {
      statusCode: Number(result.statusCode || 200),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Unable to process manual odds.", detail: error.message })
    };
  }
};

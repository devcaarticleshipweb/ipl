const { isSupabaseConfigured, runSupabaseAction } = require("./supabase-ledger");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

async function runSheetsAction(event, forcedAction = "") {
  const action = String(forcedAction || event.queryStringParameters?.action || "").trim();
  const payload = event.httpMethod === "GET" ? {} : JSON.parse(event.body || "{}");

  if (isSupabaseConfigured() && ["getLedger", "auth", "createUser", "adjustFunds", "placeBet", "settleBet"].includes(action)) {
    try {
      const result = await runSupabaseAction(action, payload);
      return json(Number(result.statusCode || 200), result);
    } catch (error) {
      return json(502, {
        error: "Unable to read or write Supabase data.",
        detail: error.message
      });
    }
  }

  const apiUrl = String(process.env.FAIR91_SHEETS_API_URL || "").trim();

  if (!apiUrl) {
    return json(502, {
      error: "Google Sheets API URL is not configured.",
      detail: "Set FAIR91_SHEETS_API_URL in Netlify environment variables."
    });
  }

  if (!action) {
    return json(400, { error: "Missing action." });
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "user-agent": "Fair91OddsViewer/1.0"
      },
      body: JSON.stringify({ action, payload })
    });
    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text };
    }

    if (!response.ok) {
      return json(response.status, body);
    }

    return json(Number(body.statusCode || 200), body);
  } catch (error) {
    return json(502, {
      error: "Unable to read or write Google Sheets data.",
      detail: error.message
    });
  }
}

exports.runSheetsAction = runSheetsAction;
exports.handler = (event) => runSheetsAction(event);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function betProfit(stake, odds) {
  return Number((odds > 20 ? (stake * odds) / 100 : stake * Math.max(0, odds - 1)).toFixed(2));
}

function fancyRateAmount(stake, rate) {
  return Number(((stake * rate) / 100).toFixed(2));
}

function fancyLiability(stake, rate, side) {
  return side === "No" ? fancyRateAmount(stake, rate) : stake;
}

function fancyProfit(stake, rate, side) {
  return side === "Yes" ? fancyRateAmount(stake, rate) : stake;
}

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Supabase request failed (${response.status}).`);
  }
  return body;
}

function appUser(row) {
  return {
    username: row.username,
    name: row.name,
    role: row.role,
    balance: row.balance,
    createdAt: row.created_at
  };
}

function appBet(row) {
  return {
    id: row.id,
    username: row.username,
    eventId: row.event_id,
    eventName: row.event_name,
    marketKey: row.market_key,
    marketName: row.market_name,
    marketType: row.market_type,
    side: row.side,
    odds: row.odds,
    run: row.run,
    target: row.target,
    rate: row.rate,
    stake: row.stake,
    liability: row.liability,
    estimatedProfit: row.estimated_profit,
    status: row.status,
    result: row.result,
    pnl: row.pnl,
    placedAt: row.placed_at,
    settledAt: row.settled_at,
    statusAtSelection: row.status_at_selection,
    verifiedAt: row.verified_at
  };
}

function publicLedger(users, bets) {
  const appUsers = users.map(appUser);
  const appBets = bets.map(appBet);
  const summary = appUsers.map((user) => {
    const userBets = appBets.filter((bet) => String(bet.username).toLowerCase() === String(user.username).toLowerCase());
    const pending = userBets.filter((bet) => bet.status === "PENDING");
    const settled = userBets.filter((bet) => bet.status === "SETTLED");
    return {
      username: user.username,
      name: user.name,
      balance: toNumber(user.balance, 0),
      totalStake: userBets.reduce((sum, bet) => sum + toNumber(bet.stake, 0), 0),
      exposure: pending.reduce((sum, bet) => sum + toNumber(bet.liability || bet.stake, 0), 0),
      pnl: settled.reduce((sum, bet) => sum + toNumber(bet.pnl, 0), 0),
      betCount: userBets.length
    };
  });

  return { users: appUsers, bets: appBets, summary, backend: "supabase" };
}

async function getLedger() {
  const [users, bets] = await Promise.all([
    supabaseFetch("/rest/v1/users?select=*&order=created_at.asc"),
    supabaseFetch("/rest/v1/bets?select=*&order=placed_at.asc")
  ]);
  return publicLedger(users || [], bets || []);
}

async function auth(payload) {
  const username = String(payload.username || "").trim().toLowerCase();
  const password = String(payload.password || "");
  const rows = await supabaseFetch(`/rest/v1/users?select=*&username=eq.${encodeURIComponent(username)}&limit=1`);
  const user = rows?.[0];
  if (!user || String(user.password || "") !== password) {
    return { statusCode: 401, error: "Invalid username or password." };
  }
  return { user: appUser(user), backend: "supabase" };
}

async function createUser(payload) {
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  const name = String(payload.name || username).trim();
  const balance = Math.max(0, toNumber(payload.balance, 0));
  if (!username || !password) return { statusCode: 400, error: "Username and password are required." };

  const existing = await supabaseFetch(`/rest/v1/users?select=username&username=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`);
  if (existing?.length) return { statusCode: 409, error: "User already exists." };

  const inserted = await supabaseFetch("/rest/v1/users", {
    method: "POST",
    body: JSON.stringify([{ username, password, name, role: "user", balance }])
  });
  return { user: appUser(inserted[0]), backend: "supabase" };
}

async function adjustFunds(payload) {
  const username = String(payload.username || "").trim();
  const amount = toNumber(payload.amount, null);
  const mode = String(payload.mode || "").toUpperCase();
  if (!username || amount === null || amount <= 0 || !["ADD", "REMOVE"].includes(mode)) {
    return { statusCode: 400, error: "Valid username, amount and mode are required." };
  }

  const users = await supabaseFetch(`/rest/v1/users?select=*&username=eq.${encodeURIComponent(username)}&limit=1`);
  const user = users?.[0];
  if (!user) return { statusCode: 404, error: "User not found." };

  const balance = toNumber(user.balance, 0);
  const nextBalance = mode === "ADD" ? balance + amount : balance - amount;
  if (nextBalance < 0) return { statusCode: 400, error: "Cannot remove more than available balance." };

  const updated = await supabaseFetch(`/rest/v1/users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify({ balance: money(nextBalance) })
  });
  return { user: appUser(updated[0]), ledger: await getLedger(), backend: "supabase" };
}

async function placeBet(payload) {
  const username = String(payload.username || "").trim();
  const stake = toNumber(payload.stake, null);
  const odds = toNumber(payload.odds, null);
  const isFancy = payload.marketType === "FANCY";
  const run = isFancy ? toNumber(payload.run || payload.target || payload.odds, "") : null;
  const target = isFancy ? toNumber(payload.target || payload.run || payload.odds, "") : null;
  const rate = isFancy ? toNumber(payload.rate, "") : null;
  const liability = toNumber(payload.liability, isFancy ? fancyLiability(stake, rate, payload.side) : stake);
  const estimatedProfit = toNumber(payload.estimatedProfit, isFancy ? fancyProfit(stake, rate, payload.side) : betProfit(stake, odds));
  if (!username || stake === null || stake <= 0 || odds === null || odds <= 0) {
    return { statusCode: 400, error: "Valid username, stake and odds are required." };
  }

  const users = await supabaseFetch(`/rest/v1/users?select=*&username=eq.${encodeURIComponent(username)}&limit=1`);
  const user = users?.[0];
  if (!user) return { statusCode: 404, error: "User not found." };
  const balance = toNumber(user.balance, 0);
  if (balance < liability) return { statusCode: 400, error: "Insufficient balance." };

  await supabaseFetch(`/rest/v1/users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify({ balance: money(balance - liability) })
  });

  const inserted = await supabaseFetch("/rest/v1/bets", {
    method: "POST",
    body: JSON.stringify([{
      username,
      event_id: payload.eventId,
      event_name: payload.eventName,
      market_key: payload.marketKey,
      market_name: payload.marketName,
      market_type: payload.marketType,
      side: payload.side,
      odds,
      run,
      target,
      rate,
      stake,
      liability,
      estimated_profit: estimatedProfit,
      status: "PENDING",
      result: "",
      pnl: 0,
      status_at_selection: payload.statusAtSelection,
      verified_at: payload.verifiedAt
    }])
  });

  return { bet: appBet(inserted[0]), ledger: await getLedger(), backend: "supabase" };
}

async function settleBet(payload) {
  const betId = String(payload.betId || "");
  const result = String(payload.result || "").toUpperCase();
  const bets = await supabaseFetch(`/rest/v1/bets?select=*&id=eq.${encodeURIComponent(betId)}&limit=1`);
  const bet = bets?.[0];
  if (!bet) return { statusCode: 404, error: "Bet not found." };
  if (bet.status !== "PENDING") return { statusCode: 400, error: "Bet is already settled." };

  const users = await supabaseFetch(`/rest/v1/users?select=*&username=eq.${encodeURIComponent(bet.username)}&limit=1`);
  const user = users?.[0];
  const liability = toNumber(bet.liability, bet.stake);
  const profit = toNumber(bet.estimated_profit, 0);
  const balance = toNumber(user?.balance, 0);
  let pnl = 0;
  let nextBalance = balance;

  if (result === "WIN") {
    pnl = profit;
    nextBalance = money(balance + liability + profit);
  } else if (result === "LOSE") {
    pnl = -liability;
  } else if (result === "VOID") {
    nextBalance = money(balance + liability);
  } else {
    return { statusCode: 400, error: "Result must be WIN, LOSE or VOID." };
  }

  await supabaseFetch(`/rest/v1/users?username=eq.${encodeURIComponent(bet.username)}`, {
    method: "PATCH",
    body: JSON.stringify({ balance: nextBalance })
  });
  const updated = await supabaseFetch(`/rest/v1/bets?id=eq.${encodeURIComponent(betId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "SETTLED", result, pnl, settled_at: new Date().toISOString() })
  });
  return { bet: appBet(updated[0]), ledger: await getLedger(), backend: "supabase" };
}

async function runSupabaseAction(action, payload = {}) {
  if (action === "getLedger") return getLedger();
  if (action === "auth") return auth(payload);
  if (action === "createUser") return createUser(payload);
  if (action === "adjustFunds") return adjustFunds(payload);
  if (action === "placeBet") return placeBet(payload);
  if (action === "settleBet") return settleBet(payload);
  return { statusCode: 404, error: "Unknown Supabase action." };
}

exports.isSupabaseConfigured = isSupabaseConfigured;
exports.runSupabaseAction = runSupabaseAction;

export default async function handler(req, res) {
  try {
    /* ===========================
       CORS (para chamar do Guide)
       =========================== */
    const origin = req.headers.origin || "";
    const allowed = [
      "https://suporte.golfleet.com.br" // ajuste pro domínio real do seu Help Center
    ];

    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    }

    // Preflight
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    // Só aceitamos GET
    if (req.method !== "GET") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    /* ===========================
       Entrada
       =========================== */
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "email_missing" });
    }

    /* ===========================
       ENV VARS (Vercel)
       =========================== */
    const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
    const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
    const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

    const USER_FIELD_KEY = "integration_token";
    const WEBHOOK_URL =
      "http://zendesk.golfleet.com.br/integration/vehicles?organizationId=123";

    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(500).json({
        error: "missing_env_vars",
        missing: {
          ZENDESK_SUBDOMAIN: !ZENDESK_SUBDOMAIN,
          ZENDESK_EMAIL: !ZENDESK_EMAIL,
          ZENDESK_API_TOKEN: !ZENDESK_API_TOKEN
        }
      });
    }

    /* ===========================
       Zendesk Auth Header (Basic)
       =========================== */
    const basic = Buffer.from(
      `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`
    ).toString("base64");

    const zendeskHeaders = {
      Authorization: `Basic ${basic}`,
      Accept: "application/json"
    };

    /* ===========================
       1) Search user by email
       =========================== */
    const searchUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/search.json?query=${encodeURIComponent(
      email
    )}`;

    const r1 = await fetch(searchUrl, { headers: zendeskHeaders });

    if (!r1.ok) {
      const t = await r1.text().catch(() => "");
      return res.status(502).json({
        error: "zendesk_search_failed",
        status: r1.status,
        body: t
      });
    }

    const searchData = await r1.json();
    const users = searchData.users || [];
    const user = users[0];

    if (!user) {
      return res.status(404).json({
        error: "user_not_found",
        email,
        searchResultCount: users.length
      });
    }

    /* ===========================
       2) Get user details (user_fields)
       =========================== */
    const userUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/${user.id}.json`;

    const r2 = await fetch(userUrl, { headers: zendeskHeaders });

    if (!r2.ok) {
      const t = await r2.text().catch(() => "");
      return res.status(502).json({
        error: "zendesk_user_failed",
        status: r2.status,
        body: t,
        zendeskUserId: user.id
      });
    }

    const userData = await r2.json();
    const integrationToken = userData?.user?.user_fields?.[USER_FIELD_KEY];

    if (!integrationToken) {
      return res.status(404).json({
        error: "integration_token_missing",
        zendeskUserId: userData?.user?.id || user.id,
        email
      });
    }

    /* ===========================
       Debug seguro (não vaza token)
       =========================== */
    const tokenStr = String(integrationToken);
    const debugInfo = {
      email,
      zendeskUserId: userData?.user?.id || user.id,
      searchResultCount: users.length,
      tokenLen: tokenStr.length,
      tokenPreview: tokenStr.slice(0, 12),
      looksLikeJwt: tokenStr.split(".").length === 3
    };

    /* ===========================
       3) Call webhook with token
       =========================== */
    const r3 = await fetch(WEBHOOK_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenStr}`
      }
    });

    if (!r3.ok) {
      const t = await r3.text().catch(() => "");
      return res.status(502).json({
        error: "webhook_failed",
        status: r3.status,
        body: t,
        debug: debugInfo
      });
    }

    const vehicles = await r3.json();

    // Se quiser garantir formato:
    if (!Array.isArray(vehicles)) {
      return res.status(502).json({
        error: "webhook_invalid_payload",
        debug: debugInfo
      });
    }

    return res.status(200).json(vehicles);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error" });
  }
}

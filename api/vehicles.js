export default async function handler(req, res) {
  try {
    // CORS básico (Guide)
    const origin = req.headers.origin || "";
    const allowed = ["https://suporte.golfleet.com.br"]; // ajuste se precisar

    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    }

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email_missing" });

    const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
    const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
    const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(500).json({ error: "missing_env_vars" });
    }

    const USER_FIELD_KEY = "integration_token";

    // ✅ TROCA IMPORTANTE: usa HTTPS
    const WEBHOOK_URL =
      "https://zendesk.golfleet.com.br/integration/vehicles?organizationId=123";

    const basic = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    const zendeskHeaders = { Authorization: `Basic ${basic}`, Accept: "application/json" };

    // 1) Search user by email
    const searchUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/search.json?query=${encodeURIComponent(email)}`;
    const r1 = await fetch(searchUrl, { headers: zendeskHeaders });

    if (!r1.ok) {
      const t = await r1.text().catch(() => "");
      return res.status(502).json({ error: "zendesk_search_failed", status: r1.status, body: t });
    }

    const searchData = await r1.json();
    const users = searchData.users || [];
    const user = users[0];
    if (!user) return res.status(404).json({ error: "user_not_found", email });

    // 2) Load user to read user_fields
    const userUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/${user.id}.json`;
    const r2 = await fetch(userUrl, { headers: zendeskHeaders });

    if (!r2.ok) {
      const t = await r2.text().catch(() => "");
      return res.status(502).json({ error: "zendesk_user_failed", status: r2.status, body: t });
    }

    const userData = await r2.json();
    const rawToken = userData?.user?.user_fields?.[USER_FIELD_KEY];

    if (!rawToken) {
      return res.status(404).json({ error: "integration_token_missing", zendeskUserId: user.id, email });
    }

    // ✅ FIX: trim no token
    const tokenToUse = String(rawToken).trim();

    const debugInfo = {
      email,
      zendeskUserId: userData?.user?.id || user.id,
      tokenLen: tokenToUse.length,
      tokenPreview: tokenToUse.slice(0, 12),
      looksLikeJwt: tokenToUse.split(".").length === 3
    };

    // 3) Call webhook
    // ✅ FIX: redirect manual para ver se tem 301/302 e pra onde
    const r3 = await fetch(WEBHOOK_URL, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenToUse}`,
        // opcional, às vezes ajuda em backend mais chato:
        "User-Agent": "golfleet-middleware/1.0"
      }
    });

    // Se tiver redirect, mostra no debug
    if (r3.status >= 300 && r3.status < 400) {
      return res.status(502).json({
        error: "webhook_redirected",
        status: r3.status,
        location: r3.headers.get("location") || null,
        debug: debugInfo
      });
    }

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
    return res.status(200).json(vehicles);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error" });
  }
}

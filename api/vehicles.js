export default async function handler(req, res) {
  try {
    // ✅ CORS básico: permita seu domínio do Guide
    const origin = req.headers.origin || "";
    const allowed = [
      "https://suporte.golfleet.com.br" 
    ];

    if (origin && allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email_missing" });

    // ✅ Variáveis que você vai configurar na Vercel
    const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN; 
    const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;         
    const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;

    const USER_FIELD_KEY = "integration_token";
    const WEBHOOK_URL = "http://zendesk.golfleet.com.br/integration/vehicles?organizationId=123";

    if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
      return res.status(500).json({ error: "missing_env_vars" });
    }

    const basic = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    const zendeskHeaders = {
      "Authorization": `Basic ${basic}`,
      "Accept": "application/json"
    };

    // 1) Search user by email
    const searchUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/search.json?query=${encodeURIComponent(email)}`;
    const r1 = await fetch(searchUrl, { headers: zendeskHeaders });

    if (!r1.ok) {
      const t = await r1.text().catch(() => "");
      return res.status(502).json({ error: "zendesk_search_failed", status: r1.status, body: t });
    }

    const searchData = await r1.json();
    const user = (searchData.users || [])[0];

    if (!user) return res.status(404).json({ error: "user_not_found" });

    // 2) Get user details to read user_fields
    const userUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/${user.id}.json`;
    const r2 = await fetch(userUrl, { headers: zendeskHeaders });

    if (!r2.ok) {
      const t = await r2.text().catch(() => "");
      return res.status(502).json({ error: "zendesk_user_failed", status: r2.status, body: t });
    }

    const userData = await r2.json();
    const integrationToken = userData?.user?.user_fields?.[USER_FIELD_KEY];

    if (!integrationToken) {
      return res.status(404).json({ error: "integration_token_missing" });
    }

    // 3) Call webhook using integrationToken
    const r3 = await fetch(WEBHOOK_URL, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${integrationToken}`
      }
    });

    if (!r3.ok) {
      const t = await r3.text().catch(() => "");
      return res.status(502).json({ error: "webhook_failed", status: r3.status, body: t });
    }

    const vehicles = await r3.json();
    return res.status(200).json(vehicles);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "internal_error" });
  }
}

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
app.set("trust proxy", true);

const PORT = Number(process.env.PORT || 8787);
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-me";
const GOOGLE_SITE_VERIFICATION = String(process.env.GOOGLE_SITE_VERIFICATION || "").trim();
const YANDEX_VERIFICATION = String(process.env.YANDEX_VERIFICATION || "").trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_STATE_TABLE = String(process.env.SUPABASE_STATE_TABLE || "app_state").trim();
const SUPABASE_STATE_KEY = String(process.env.SUPABASE_STATE_KEY || "main").trim();

const CARDLINK_API_BASE = (process.env.CARDLINK_API_BASE || "https://cardlink.link").replace(/\/+$/, "");
const CARDLINK_API_TOKEN = process.env.CARDLINK_API_TOKEN || "";
const CARDLINK_SHOP_ID = process.env.CARDLINK_SHOP_ID || "";
const CARDLINK_CURRENCY = process.env.CARDLINK_CURRENCY || "RUB";
const CARDLINK_PAYER_PAYS_COMMISSION = process.env.CARDLINK_PAYER_PAYS_COMMISSION || "1";
const CARDLINK_BILL_TTL = process.env.CARDLINK_BILL_TTL || "";

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@liquid.local").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin12345";

const PLAN_CONFIG = {
  free: {
    id: "free",
    label: "Free",
    amount: 0,
    currency: CARDLINK_CURRENCY,
    allowedTypes: ["text", "image", "post"]
  },
  plus: {
    id: "plus",
    label: "Plus",
    amount: Number(process.env.PLAN_PLUS_AMOUNT || 19),
    currency: CARDLINK_CURRENCY,
    allowedTypes: ["text", "image", "video", "audio", "post"]
  },
  pro: {
    id: "pro",
    label: "Pro",
    amount: Number(process.env.PLAN_PRO_AMOUNT || 59),
    currency: CARDLINK_CURRENCY,
    allowedTypes: ["text", "image", "video", "audio", "post"]
  }
};

const PAYMENT_SUCCESS_STATUSES = new Set(["SUCCESS", "OVERPAID"]);
const PAYMENT_FAILURE_STATUSES = new Set(["FAIL"]);
const USER_STATUSES = new Set(["active", "blocked"]);
const USER_ROLES = new Set(["user", "admin"]);
const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "converted", "archived"]);

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const APP_INDEX_PATH = path.join(ROOT_DIR, "index.html");
const LANDING_PATH = path.join(PUBLIC_DIR, "landing.html");
const DB_PATH = path.join(__dirname, "data", "db.json");

const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const SUPABASE_PARTIAL = Boolean(SUPABASE_URL || SUPABASE_SERVICE_ROLE_KEY) && !SUPABASE_READY;
const DB_PROVIDER = SUPABASE_READY ? "supabase" : "file";
const supabase = SUPABASE_READY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

let writeQueue = Promise.resolve();
let runtimeReadyPromise = null;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.get("/sw.js", (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(PUBLIC_DIR, "sw.js"));
});
app.get("/landing.html", (_req, res) => {
  res.redirect(301, "/");
});
app.use(express.static(PUBLIC_DIR));
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  try {
    await ensureRuntimeReady();
    return next();
  } catch (error) {
    console.error("[bootstrap]", error);
    return res.status(500).json({
      error: "Не удалось инициализировать базу данных."
    });
  }
});

app.get("/robots.txt", (req, res) => {
  const baseUrl = getPublicBaseUrl(req);
  const host = new URL(baseUrl).host;
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /server/",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    `Host: ${host}`
  ];

  res.type("text/plain; charset=utf-8").send(lines.join("\n"));
});

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = getPublicBaseUrl(req);
  const lastmod = new Date().toISOString();
  const entries = [
    { loc: `${baseUrl}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${baseUrl}/app`, changefreq: "weekly", priority: "0.8" }
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => {
      return [
        "  <url>",
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        "  </url>"
      ].join("\n");
    }),
    "</urlset>"
  ].join("\n");

  res.type("application/xml; charset=utf-8").send(xml);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/plans", (_req, res) => {
  res.json({
    billingProvider: "cardlink",
    cardlinkReady: isCardlinkReady(),
    plans: toClientPlans()
  });
});

app.post("/api/leads", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim();
  const company = String(req.body.company || "").trim();
  const goal = String(req.body.goal || "").trim();
  const source = String(req.body.source || "landing").trim().toLowerCase() || "landing";

  if (name.length < 2) {
    return res.status(400).json({ error: "Укажите имя (минимум 2 символа)." });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Укажите корректный email." });
  }

  try {
    const lead = await mutateDb((db) => {
      const now = new Date().toISOString();
      const nextLead = {
        id: makeId(),
        name: clampText(name, 120),
        email: clampText(email, 160),
        phone: clampText(phone, 80),
        company: clampText(company, 160),
        goal: clampText(goal, 1200),
        source: clampText(source, 80),
        status: "new",
        note: "",
        createdAt: now,
        updatedAt: now
      };

      db.leads.push(nextLead);
      return sanitizeLead(nextLead);
    });

    return res.status(201).json({ ok: true, lead });
  } catch (error) {
    console.error("[create-lead]", error);
    return res.status(500).json({ error: "Не удалось сохранить заявку." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const fullName = String(req.body.fullName || "").trim();
  const username = String(req.body.username || "").trim();

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Некорректный email." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Пароль должен быть не короче 8 символов." });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await mutateDb((db) => {
      const exists = db.users.some((entry) => entry.email === email);
      if (exists) {
        throw new Error("EMAIL_IN_USE");
      }

      const now = new Date().toISOString();
      const nextUser = {
        id: makeId(),
        email,
        passwordHash,
        role: "user",
        status: "active",
        planId: "free",
        planStatus: "inactive",
        profile: {
          fullName,
          username,
          website: "",
          bio: ""
        },
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        lastPaymentAt: null
      };

      db.users.push(nextUser);
      return sanitizeUser(nextUser);
    });

    const token = makeToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    if (error.message === "EMAIL_IN_USE") {
      return res.status(409).json({ error: "Пользователь с таким email уже существует." });
    }

    console.error("[register]", error);
    return res.status(500).json({ error: "Не удалось создать аккаунт." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email и пароль обязательны." });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Неверный email или пароль." });
  }

  if (user.status === "blocked") {
    return res.status(403).json({ error: "Аккаунт заблокирован администратором." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Неверный email или пароль." });
  }

  const updatedUser = await patchUserById(user.id, (entry) => {
    entry.lastLoginAt = new Date().toISOString();
  });

  const publicUser = updatedUser || sanitizeUser(user);
  const token = makeToken(publicUser);

  return res.json({ token, user: publicUser });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.patch("/api/profile", requireAuth, async (req, res) => {
  const payload = {
    fullName: req.body.fullName,
    username: req.body.username,
    email: req.body.email,
    website: req.body.website,
    bio: req.body.bio
  };

  const normalizedEmail = payload.email ? String(payload.email).trim().toLowerCase() : null;
  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Некорректный email." });
  }

  try {
    const updated = await mutateDb((db) => {
      const user = db.users.find((entry) => entry.id === req.user.id);
      if (!user) {
        throw new Error("NOT_FOUND");
      }

      if (normalizedEmail && normalizedEmail !== user.email) {
        const taken = db.users.some((entry) => entry.email === normalizedEmail && entry.id !== user.id);
        if (taken) {
          throw new Error("EMAIL_IN_USE");
        }
      }

      if (typeof payload.fullName === "string") {
        user.profile.fullName = payload.fullName.trim();
      }
      if (typeof payload.username === "string") {
        user.profile.username = payload.username.trim();
      }
      if (typeof payload.website === "string") {
        user.profile.website = payload.website.trim();
      }
      if (typeof payload.bio === "string") {
        user.profile.bio = payload.bio.trim();
      }
      if (normalizedEmail) {
        user.email = normalizedEmail;
      }

      user.updatedAt = new Date().toISOString();
      return sanitizeUser(user);
    });

    return res.json({ user: updated });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Пользователь не найден." });
    }
    if (error.message === "EMAIL_IN_USE") {
      return res.status(409).json({ error: "Этот email уже используется." });
    }

    console.error("[profile-update]", error);
    return res.status(500).json({ error: "Не удалось обновить профиль." });
  }
});

app.post("/api/billing/create-checkout-session", requireAuth, createCardlinkBillHandler);
app.post("/api/billing/cardlink/create-bill", requireAuth, createCardlinkBillHandler);

app.get("/api/billing/cardlink/order-status", requireAuth, async (req, res) => {
  const invId = String(req.query.invId || req.query.orderId || "").trim();
  if (!invId) {
    return res.status(400).json({ error: "invId обязателен." });
  }

  const db = await readDb();
  const payment = db.payments.find((entry) => entry.orderId === invId && entry.userId === req.user.id);
  if (!payment) {
    return res.status(404).json({ error: "Платеж не найден." });
  }

  const freshUser = db.users.find((entry) => entry.id === req.user.id);
  return res.json({
    payment: toClientPayment(payment),
    userPlan: freshUser ? freshUser.planId : req.user.planId
  });
});

app.get("/api/billing/payments", requireAuth, async (req, res) => {
  const limit = clampInt(req.query.limit, 20, 1, 200);
  const db = await readDb();
  const rows = db.payments
    .filter((entry) => entry.userId === req.user.id)
    .sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt))
    .slice(0, limit)
    .map(toClientPayment);

  return res.json({ data: rows });
});

app.post("/api/billing/cardlink/postback", async (req, res) => {
  try {
    await applyCardlinkPayload(req.body, "result", true);
    return res.status(200).send("OK");
  } catch (error) {
    if (error.message === "INVALID_SIGNATURE") {
      return res.status(403).send("INVALID_SIGNATURE");
    }
    if (error.message === "EMPTY_INVOICE") {
      return res.status(400).send("InvId is required");
    }

    console.error("[cardlink-postback]", error);
    return res.status(500).send("ERROR");
  }
});

app.post("/api/billing/cardlink/success", async (req, res) => {
  await handleCardlinkRedirect(req, res, "success");
});

app.post("/api/billing/cardlink/fail", async (req, res) => {
  await handleCardlinkRedirect(req, res, "cancel");
});

app.get("/api/billing/cardlink/success", async (req, res) => {
  await handleCardlinkRedirect(req, res, "success");
});

app.get("/api/billing/cardlink/fail", async (req, res) => {
  await handleCardlinkRedirect(req, res, "cancel");
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  const db = await readDb();
  return res.json(buildAdminOverview(db));
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const search = String(req.query.search || "").trim().toLowerCase();
  const plan = normalizePlanId(req.query.plan) || "";
  const role = USER_ROLES.has(String(req.query.role || "").toLowerCase())
    ? String(req.query.role).toLowerCase()
    : "";
  const status = USER_STATUSES.has(String(req.query.status || "").toLowerCase())
    ? String(req.query.status).toLowerCase()
    : "";

  const page = clampInt(req.query.page, 1, 1, 99999);
  const perPage = clampInt(req.query.perPage, 30, 1, 200);

  let rows = db.users.slice();

  if (search) {
    rows = rows.filter((user) => {
      const haystack = [user.email, user.profile?.fullName || "", user.profile?.username || ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  if (plan) {
    rows = rows.filter((user) => user.planId === plan);
  }

  if (role) {
    rows = rows.filter((user) => user.role === role);
  }

  if (status) {
    rows = rows.filter((user) => user.status === status);
  }

  const mapped = rows.map((user) => {
    const payments = db.payments.filter((payment) => payment.userId === user.id);
    const successful = payments.filter((payment) => PAYMENT_SUCCESS_STATUSES.has(payment.status));
    const totalPaid = successful.reduce((sum, payment) => sum + (Number(payment.outSum || payment.amount || 0)), 0);
    const lastPaymentAt = successful
      .map((payment) => payment.updatedAt)
      .sort((a, b) => toTimestamp(b) - toTimestamp(a))[0] || null;

    return {
      ...sanitizeUser(user),
      successfulPayments: successful.length,
      totalPaid,
      lastPaymentAt
    };
  });

  mapped.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

  const total = mapped.length;
  const start = (page - 1) * perPage;
  const data = mapped.slice(start, start + perPage);

  return res.json({
    data,
    meta: {
      page,
      perPage,
      total,
      pages: Math.max(1, Math.ceil(total / perPage))
    }
  });
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const userId = String(req.params.id || "").trim();
  const nextPlan = req.body.planId ? normalizePlanId(req.body.planId) : null;
  const nextRole = req.body.role ? String(req.body.role).toLowerCase() : null;
  const nextStatus = req.body.status ? String(req.body.status).toLowerCase() : null;

  if (req.body.planId && !nextPlan) {
    return res.status(400).json({ error: "Некорректный planId." });
  }

  if (nextRole && !USER_ROLES.has(nextRole)) {
    return res.status(400).json({ error: "Некорректная роль." });
  }

  if (nextStatus && !USER_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: "Некорректный статус." });
  }

  try {
    const updated = await mutateDb((db) => {
      const user = db.users.find((entry) => entry.id === userId);
      if (!user) {
        throw new Error("NOT_FOUND");
      }

      if (nextPlan) {
        user.planId = nextPlan;
        user.planStatus = nextPlan === "free" ? "inactive" : "active";
      }

      if (nextRole) {
        user.role = nextRole;
      }

      if (nextStatus) {
        user.status = nextStatus;
      }

      user.updatedAt = new Date().toISOString();
      return sanitizeUser(user);
    });

    return res.json({ user: updated });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Пользователь не найден." });
    }

    console.error("[admin-update-user]", error);
    return res.status(500).json({ error: "Не удалось обновить пользователя." });
  }
});

app.get("/api/admin/payments", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const status = String(req.query.status || "").trim().toUpperCase();
  const planId = normalizePlanId(req.query.planId) || "";
  const userId = String(req.query.userId || "").trim();
  const limit = clampInt(req.query.limit, 50, 1, 500);

  let rows = db.payments.slice();

  if (status) {
    rows = rows.filter((payment) => payment.status === status);
  }

  if (planId) {
    rows = rows.filter((payment) => payment.planId === planId);
  }

  if (userId) {
    rows = rows.filter((payment) => payment.userId === userId);
  }

  rows.sort((a, b) => toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt));

  const data = rows.slice(0, limit).map((payment) => {
    const user = db.users.find((entry) => entry.id === payment.userId);
    return {
      ...toClientPayment(payment),
      userEmail: user?.email || "-",
      userName: user?.profile?.fullName || user?.profile?.username || "-"
    };
  });

  return res.json({ data });
});

app.get("/api/admin/leads", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const status = String(req.query.status || "").trim().toLowerCase();
  const limit = clampInt(req.query.limit, 120, 1, 500);

  let rows = db.leads.slice();
  if (status && LEAD_STATUSES.has(status)) {
    rows = rows.filter((lead) => lead.status === status);
  }

  rows.sort((a, b) => toTimestamp(b.updatedAt || b.createdAt) - toTimestamp(a.updatedAt || a.createdAt));

  return res.json({
    data: rows.slice(0, limit).map(sanitizeLead)
  });
});

app.patch("/api/admin/leads/:id", requireAuth, requireAdmin, async (req, res) => {
  const leadId = String(req.params.id || "").trim();
  const nextStatus = String(req.body.status || "").trim().toLowerCase();
  const nextNote = req.body.note == null ? null : String(req.body.note || "").trim();

  if (nextStatus && !LEAD_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: "Некорректный статус лида." });
  }

  try {
    const lead = await mutateDb((db) => {
      const row = db.leads.find((entry) => entry.id === leadId);
      if (!row) {
        throw new Error("NOT_FOUND");
      }

      if (nextStatus) {
        row.status = nextStatus;
      }
      if (nextNote !== null) {
        row.note = clampText(nextNote, 1200);
      }
      row.updatedAt = new Date().toISOString();
      return sanitizeLead(row);
    });

    return res.json({ lead });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Лид не найден." });
    }

    console.error("[admin-update-lead]", error);
    return res.status(500).json({ error: "Не удалось обновить лид." });
  }
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "styles.css"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "app.js"));
});

app.get("/index.html", (_req, res) => {
  res.redirect(302, "/app");
});

app.get("/app", (_req, res) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.sendFile(APP_INDEX_PATH);
});

app.get("/app/", (_req, res) => {
  res.redirect(302, "/app");
});

app.get(/^\/app\/.+/, (_req, res) => {
  res.redirect(302, "/app");
});

app.get("/", async (req, res) => {
  await sendLandingPage(req, res);
});

app.get("/landing", async (req, res) => {
  await sendLandingPage(req, res);
});

app.get("/favicon.ico", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "icons", "icon-192.png"));
});

app.get(/^\/(?!api(?:\/|$)).*/, async (req, res) => {
  await sendLandingPage(req, res);
});

if (require.main === module) {
  void startServer();
}

module.exports = app;

async function startServer() {
  await ensureRuntimeReady();

  app.listen(PORT, () => {
    console.log(`[server] running on ${CLIENT_URL}`);
    console.log(`[server] db provider: ${DB_PROVIDER}`);
    if (SUPABASE_PARTIAL) {
      console.log("[server] supabase config is incomplete, fallback to file DB");
    }
    console.log(`[server] cardlink ready: ${isCardlinkReady() ? "yes" : "no"}`);
    console.log(`[server] admin login: ${ADMIN_EMAIL}`);
  });
}

async function createCardlinkBillHandler(req, res) {
  const planId = normalizePlanId(req.body.planId);
  if (!planId || planId === "free") {
    return res.status(400).json({ error: "Выберите платный тариф: Plus или Pro." });
  }

  if (!isCardlinkReady()) {
    return res.status(503).json({ error: "Cardlink не настроен в окружении сервера." });
  }

  const plan = PLAN_CONFIG[planId];
  const orderId = makeOrderId(req.user.id, planId);
  const customPayload = JSON.stringify({ app: "lcs", userId: req.user.id, planId });

  const payload = new URLSearchParams();
  payload.set("amount", formatAmount(plan.amount));
  payload.set("shop_id", CARDLINK_SHOP_ID);
  payload.set("order_id", orderId);
  payload.set("description", `Liquid Content Studio ${plan.label}`);
  payload.set("type", "normal");
  payload.set("currency_in", plan.currency);
  payload.set("custom", customPayload);
  payload.set("payer_pays_commission", CARDLINK_PAYER_PAYS_COMMISSION);
  payload.set("name", `Подписка ${plan.label}`);
  payload.set("success_url", `${CLIENT_URL}/api/billing/cardlink/success`);
  payload.set("fail_url", `${CLIENT_URL}/api/billing/cardlink/fail`);
  if (CARDLINK_BILL_TTL) {
    payload.set("ttl", CARDLINK_BILL_TTL);
  }

  let response;
  try {
    response = await fetch(`${CARDLINK_API_BASE}/api/v1/bill/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CARDLINK_API_TOKEN}`
      },
      body: payload
    });
  } catch (error) {
    console.error("[cardlink-create-fetch]", error);
    return res.status(502).json({ error: "Не удалось подключиться к Cardlink." });
  }

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (_error) {
    data = null;
  }

  if (!response.ok || !data || !isTruthy(data.success)) {
    const providerError = data?.error || data?.message || response.statusText || "Cardlink error";
    return res.status(502).json({ error: `Ошибка Cardlink: ${providerError}` });
  }

  const linkUrl = String(data.link_url || "").trim();
  const linkPageUrl = String(data.link_page_url || linkUrl || "").trim();
  const billId = String(data.bill_id || "").trim();

  if (!billId || !linkPageUrl) {
    return res.status(502).json({ error: "Cardlink вернул неполный ответ при создании счета." });
  }

  await mutateDb((db) => {
    const now = new Date().toISOString();
    db.payments.push({
      id: makeId(),
      provider: "cardlink",
      billId,
      orderId,
      userId: req.user.id,
      planId,
      amount: plan.amount,
      outSum: null,
      commission: null,
      currency: plan.currency,
      status: "NEW",
      trsId: null,
      custom: customPayload,
      linkUrl,
      linkPageUrl,
      source: "create-bill",
      raw: data,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      failedAt: null
    });
    return null;
  });

  return res.json({
    url: linkPageUrl,
    orderId,
    billId
  });
}

async function handleCardlinkRedirect(req, res, checkoutState) {
  try {
    await applyCardlinkPayload({ ...req.query, ...req.body }, "redirect", false);
  } catch (error) {
    if (error.message !== "EMPTY_INVOICE" && error.message !== "INVALID_SIGNATURE") {
      console.error("[cardlink-redirect]", error);
    }
  }

  const invId = String(req.body.InvId || req.query.InvId || req.body.inv_id || req.query.inv_id || "").trim();
  const url = new URL("/app", CLIENT_URL);
  url.searchParams.set("checkout", checkoutState);
  if (invId) {
    url.searchParams.set("inv_id", invId);
  }

  return res.redirect(303, url.toString());
}

async function applyCardlinkPayload(payload, source, strictSignature) {
  const invId = String(payload.InvId || payload.inv_id || "").trim();
  if (!invId) {
    throw new Error("EMPTY_INVOICE");
  }

  const outSumRaw = String(payload.OutSum || payload.out_sum || "").trim();
  const signatureRaw = String(payload.SignatureValue || payload.signature || "").trim();
  if (signatureRaw || strictSignature) {
    const expected = makeCardlinkSignature(outSumRaw, invId);
    if (!signatureRaw || signatureRaw.toUpperCase() !== expected) {
      throw new Error("INVALID_SIGNATURE");
    }
  }

  const status = String(payload.Status || "PROCESS").trim().toUpperCase();
  const trsId = String(payload.TrsId || payload.trs_id || "").trim() || null;
  const commission = toNumberOrNull(payload.Commission);
  const outSum = toNumberOrNull(payload.OutSum);
  const currency = String(payload.CurrencyIn || payload.currency || CARDLINK_CURRENCY).trim().toUpperCase();
  const customRaw = String(payload.custom || "").trim();
  const customData = parseCustom(customRaw);

  await mutateDb((db) => {
    const now = new Date().toISOString();

    let payment = db.payments.find((entry) => entry.orderId === invId);
    if (!payment) {
      payment = {
        id: makeId(),
        provider: "cardlink",
        billId: null,
        orderId: invId,
        userId: customData?.userId || null,
        planId: normalizePlanId(customData?.planId) || "free",
        amount: outSum,
        outSum,
        commission,
        currency,
        status,
        trsId,
        custom: customRaw || null,
        linkUrl: null,
        linkPageUrl: null,
        source,
        raw: payload,
        createdAt: now,
        updatedAt: now,
        paidAt: null,
        failedAt: null
      };
      db.payments.push(payment);
    } else {
      payment.status = status;
      payment.trsId = trsId || payment.trsId;
      payment.outSum = outSum ?? payment.outSum;
      payment.commission = commission ?? payment.commission;
      payment.currency = currency || payment.currency;
      payment.custom = customRaw || payment.custom;
      payment.raw = payload;
      payment.source = source;
      payment.updatedAt = now;
    }

    if (PAYMENT_SUCCESS_STATUSES.has(status)) {
      payment.paidAt = now;
    }

    if (PAYMENT_FAILURE_STATUSES.has(status)) {
      payment.failedAt = now;
    }

    const userId = payment.userId || customData?.userId;
    if (userId) {
      const user = db.users.find((entry) => entry.id === userId);
      if (user) {
        payment.userId = user.id;
        if (PAYMENT_SUCCESS_STATUSES.has(status)) {
          const planId = normalizePlanId(payment.planId || customData?.planId);
          if (planId && planId !== "free") {
            user.planId = planId;
            user.planStatus = "active";
          }
          user.lastPaymentAt = now;
          user.updatedAt = now;
        }

        if (PAYMENT_FAILURE_STATUSES.has(status)) {
          user.planStatus = "payment_failed";
          user.updatedAt = now;
        }
      }
    }

    payment.updatedAt = now;
    return null;
  });
}

function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Требуется авторизация." });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return res.status(401).json({ error: "Невалидный токен." });
  }

  findUserById(payload.sub)
    .then((user) => {
      if (!user) {
        return res.status(401).json({ error: "Пользователь не найден." });
      }

      if (user.status === "blocked") {
        return res.status(403).json({ error: "Аккаунт заблокирован." });
      }

      req.user = user;
      return next();
    })
    .catch((error) => {
      console.error("[require-auth]", error);
      return res.status(500).json({ error: "Ошибка авторизации." });
    });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Доступ только для администратора." });
  }

  return next();
}

function makeToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: "30d"
  });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: USER_ROLES.has(user.role) ? user.role : "user",
    status: USER_STATUSES.has(user.status) ? user.status : "active",
    planId: normalizePlanId(user.planId) || "free",
    planStatus: user.planStatus || "inactive",
    profile: {
      fullName: user.profile?.fullName || "",
      username: user.profile?.username || "",
      website: user.profile?.website || "",
      bio: user.profile?.bio || ""
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null,
    lastPaymentAt: user.lastPaymentAt || null
  };
}

function toClientPlans() {
  return {
    free: {
      id: "free",
      label: "Free",
      amount: 0,
      currency: CARDLINK_CURRENCY,
      checkoutAvailable: false
    },
    plus: {
      id: "plus",
      label: "Plus",
      amount: PLAN_CONFIG.plus.amount,
      currency: PLAN_CONFIG.plus.currency,
      checkoutAvailable: isCardlinkReady()
    },
    pro: {
      id: "pro",
      label: "Pro",
      amount: PLAN_CONFIG.pro.amount,
      currency: PLAN_CONFIG.pro.currency,
      checkoutAvailable: isCardlinkReady()
    }
  };
}

function toClientPayment(payment) {
  return {
    id: payment.id,
    provider: payment.provider,
    billId: payment.billId,
    orderId: payment.orderId,
    userId: payment.userId,
    planId: payment.planId,
    amount: payment.amount,
    outSum: payment.outSum,
    commission: payment.commission,
    currency: payment.currency,
    status: payment.status,
    trsId: payment.trsId,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt
  };
}

function sanitizeLead(lead) {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone || "",
    company: lead.company || "",
    goal: lead.goal || "",
    source: lead.source || "landing",
    status: LEAD_STATUSES.has(lead.status) ? lead.status : "new",
    note: lead.note || "",
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

function buildAdminOverview(db) {
  const users = db.users;
  const payments = db.payments;
  const leads = db.leads;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.status === "active").length;
  const blockedUsers = users.filter((user) => user.status === "blocked").length;
  const paidUsers = users.filter((user) => user.planId !== "free" && user.planStatus === "active").length;
  const newUsers30d = users.filter((user) => toTimestamp(user.createdAt) >= thirtyDaysAgo).length;

  const successfulPayments = payments.filter((payment) => PAYMENT_SUCCESS_STATUSES.has(payment.status));
  const failedPayments = payments.filter((payment) => PAYMENT_FAILURE_STATUSES.has(payment.status));
  const processingPayments = payments.filter(
    (payment) => !PAYMENT_SUCCESS_STATUSES.has(payment.status) && !PAYMENT_FAILURE_STATUSES.has(payment.status)
  );

  const revenueTotal = successfulPayments.reduce(
    (sum, payment) => sum + Number(payment.outSum || payment.amount || 0),
    0
  );

  const revenueThisMonth = successfulPayments
    .filter((payment) => toTimestamp(payment.updatedAt) >= monthStart)
    .reduce((sum, payment) => sum + Number(payment.outSum || payment.amount || 0), 0);

  const monthSeries = buildMonthSeries(successfulPayments, 6);
  const newLeads30d = leads.filter((lead) => toTimestamp(lead.createdAt) >= thirtyDaysAgo).length;
  const convertedLeads = leads.filter((lead) => lead.status === "converted").length;

  return {
    users: {
      totalUsers,
      activeUsers,
      blockedUsers,
      paidUsers,
      newUsers30d
    },
    payments: {
      totalPayments: payments.length,
      successfulPayments: successfulPayments.length,
      failedPayments: failedPayments.length,
      processingPayments: processingPayments.length,
      revenueTotal,
      revenueThisMonth
    },
    leads: {
      totalLeads: leads.length,
      newLeads30d,
      convertedLeads
    },
    series: {
      monthlyRevenue: monthSeries
    }
  };
}

function buildMonthSeries(payments, monthsCount) {
  const map = new Map();
  const now = new Date();

  for (let i = monthsCount - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, 0);
  }

  for (const payment of payments) {
    const date = new Date(payment.updatedAt || payment.createdAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) {
      continue;
    }

    map.set(key, map.get(key) + Number(payment.outSum || payment.amount || 0));
  }

  return Array.from(map.entries()).map(([month, revenue]) => ({ month, revenue }));
}

async function ensureAdminUser() {
  const existing = await findUserByEmail(ADMIN_EMAIL);
  if (existing) {
    if (existing.role !== "admin") {
      await patchUserById(existing.id, (user) => {
        user.role = "admin";
        user.status = "active";
      });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await mutateDb((db) => {
    const now = new Date().toISOString();
    db.users.push({
      id: makeId(),
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      status: "active",
      planId: "pro",
      planStatus: "active",
      profile: {
        fullName: "System Admin",
        username: "admin",
        website: "",
        bio: ""
      },
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      lastPaymentAt: null
    });
    return null;
  });
}

function makeCardlinkSignature(outSum, invId) {
  return md5Upper(`${outSum}:${invId}:${CARDLINK_API_TOKEN}`);
}

async function findUserByEmail(email) {
  const db = await readDb();
  return db.users.find((entry) => entry.email === email) || null;
}

async function findUserById(userId) {
  const db = await readDb();
  return db.users.find((entry) => entry.id === userId) || null;
}

async function patchUserById(userId, patcher) {
  return mutateDb((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    if (!user) {
      return null;
    }

    patcher(user);
    user.updatedAt = new Date().toISOString();
    return sanitizeUser(user);
  });
}

async function ensureRuntimeReady() {
  if (runtimeReadyPromise) {
    return runtimeReadyPromise;
  }

  runtimeReadyPromise = (async () => {
    await ensureDb();
    await ensureAdminUser();
  })().catch((error) => {
    runtimeReadyPromise = null;
    throw error;
  });

  return runtimeReadyPromise;
}

async function ensureDb() {
  if (isSupabaseReady()) {
    await ensureSupabaseStateRow();
    return;
  }

  await ensureLocalDb();
}

async function ensureLocalDb() {
  try {
    await fs.access(DB_PATH);
  } catch (_error) {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(createDefaultDb(), null, 2));
  }
}

async function ensureSupabaseStateRow() {
  const payload = createDefaultDb();
  const { error } = await supabase
    .from(SUPABASE_STATE_TABLE)
    .upsert(
      {
        id: SUPABASE_STATE_KEY,
        payload,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "id",
        ignoreDuplicates: true
      }
    );

  if (error) {
    throw new Error(`[supabase-ensure] ${error.message}`);
  }
}

async function readDb() {
  await ensureDb();

  if (isSupabaseReady()) {
    return readSupabaseDb();
  }

  const raw = await fs.readFile(DB_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return normalizeDb(parsed);
  } catch (_error) {
    return createDefaultDb();
  }
}

async function readSupabaseDb() {
  const { data, error } = await supabase
    .from(SUPABASE_STATE_TABLE)
    .select("payload")
    .eq("id", SUPABASE_STATE_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(`[supabase-read] ${error.message}`);
  }

  if (!data || typeof data.payload !== "object" || data.payload === null) {
    return createDefaultDb();
  }

  return normalizeDb(data.payload);
}

async function writeDb(db) {
  if (isSupabaseReady()) {
    await writeSupabaseDb(db);
    return;
  }

  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function writeSupabaseDb(db) {
  const payload = normalizeDb(db);
  const { error } = await supabase
    .from(SUPABASE_STATE_TABLE)
    .upsert(
      {
        id: SUPABASE_STATE_KEY,
        payload,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "id"
      }
    );

  if (error) {
    throw new Error(`[supabase-write] ${error.message}`);
  }
}

function mutateDb(mutator) {
  const operation = writeQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });

  writeQueue = operation.catch(() => undefined);
  return operation;
}

function normalizeDb(db) {
  const safe = {
    users: Array.isArray(db?.users) ? db.users : [],
    payments: Array.isArray(db?.payments) ? db.payments : [],
    leads: Array.isArray(db?.leads) ? db.leads : []
  };

  safe.users = safe.users.map((user) => {
    const now = new Date().toISOString();
    return {
      id: user.id || makeId(),
      email: String(user.email || "").toLowerCase(),
      passwordHash: user.passwordHash || "",
      role: USER_ROLES.has(user.role) ? user.role : "user",
      status: USER_STATUSES.has(user.status) ? user.status : "active",
      planId: normalizePlanId(user.planId) || "free",
      planStatus: user.planStatus || "inactive",
      profile: {
        fullName: user.profile?.fullName || "",
        username: user.profile?.username || "",
        website: user.profile?.website || "",
        bio: user.profile?.bio || ""
      },
      createdAt: user.createdAt || now,
      updatedAt: user.updatedAt || now,
      lastLoginAt: user.lastLoginAt || null,
      lastPaymentAt: user.lastPaymentAt || null
    };
  });

  safe.payments = safe.payments.map((payment) => {
    const now = new Date().toISOString();
    return {
      id: payment.id || makeId(),
      provider: payment.provider || "cardlink",
      billId: payment.billId || null,
      orderId: payment.orderId || "",
      userId: payment.userId || null,
      planId: normalizePlanId(payment.planId) || "free",
      amount: toNumberOrNull(payment.amount),
      outSum: toNumberOrNull(payment.outSum),
      commission: toNumberOrNull(payment.commission),
      currency: payment.currency || CARDLINK_CURRENCY,
      status: String(payment.status || "NEW").toUpperCase(),
      trsId: payment.trsId || null,
      custom: payment.custom || null,
      linkUrl: payment.linkUrl || null,
      linkPageUrl: payment.linkPageUrl || null,
      source: payment.source || "unknown",
      raw: payment.raw || null,
      createdAt: payment.createdAt || now,
      updatedAt: payment.updatedAt || now,
      paidAt: payment.paidAt || null,
      failedAt: payment.failedAt || null
    };
  });

  safe.leads = safe.leads.map((lead) => {
    const now = new Date().toISOString();
    const status = String(lead.status || "").toLowerCase();
    return {
      id: lead.id || makeId(),
      name: clampText(String(lead.name || "").trim(), 120),
      email: clampText(String(lead.email || "").trim().toLowerCase(), 160),
      phone: clampText(String(lead.phone || "").trim(), 80),
      company: clampText(String(lead.company || "").trim(), 160),
      goal: clampText(String(lead.goal || "").trim(), 1200),
      source: clampText(String(lead.source || "landing").trim().toLowerCase(), 80),
      status: LEAD_STATUSES.has(status) ? status : "new",
      note: clampText(String(lead.note || "").trim(), 1200),
      createdAt: lead.createdAt || now,
      updatedAt: lead.updatedAt || lead.createdAt || now
    };
  });

  return safe;
}

function createDefaultDb() {
  return {
    users: [],
    payments: [],
    leads: []
  };
}

function makeId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeOrderId(userId, planId) {
  return `sub-${planId}-${userId.slice(0, 8)}-${Date.now()}`;
}

function md5Upper(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex").toUpperCase();
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toTimestamp(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "0.00";
  }

  return amount.toFixed(2);
}

async function sendLandingPage(req, res) {
  try {
    const html = await renderLandingHtml(req);
    return res.type("text/html; charset=utf-8").send(html);
  } catch (error) {
    console.error("[landing-render]", error);
    return res.status(500).send("Internal Server Error");
  }
}

async function renderLandingHtml(req) {
  const template = await fs.readFile(LANDING_PATH, "utf8");
  const baseUrl = getPublicBaseUrl(req);

  let html = template
    .replaceAll("__BASE_URL__", baseUrl)
    .replaceAll("__GOOGLE_SITE_VERIFICATION__", GOOGLE_SITE_VERIFICATION)
    .replaceAll("__YANDEX_VERIFICATION__", YANDEX_VERIFICATION);

  if (!GOOGLE_SITE_VERIFICATION) {
    html = html.replace(/^\s*<meta name="google-site-verification"[^>]*>\s*$/m, "");
  }
  if (!YANDEX_VERIFICATION) {
    html = html.replace(/^\s*<meta name="yandex-verification"[^>]*>\s*$/m, "");
  }

  return html;
}

function getPublicBaseUrl(req) {
  const fallback = normalizeBaseUrl(CLIENT_URL);
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) {
    return fallback;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  return normalizeBaseUrl(`${protocol}://${host}`);
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch (_error) {
    return `http://localhost:${PORT}`;
  }
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePlanId(value) {
  const planId = String(value || "").toLowerCase();
  return PLAN_CONFIG[planId] ? planId : null;
}

function parseCustom(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function isTruthy(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["true", "1", "yes"].includes(String(value || "").toLowerCase());
}

function isCardlinkReady() {
  return Boolean(CARDLINK_API_TOKEN && CARDLINK_SHOP_ID);
}

function isSupabaseReady() {
  return SUPABASE_READY && Boolean(supabase);
}

function isValidEmail(value) {
  if (!value) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clampText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

function clampInt(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, parsed));
}

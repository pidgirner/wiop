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
const OPENAI_API_BASE = String(process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
const OPENAI_TEMPERATURE = Number.isFinite(Number(process.env.OPENAI_TEMPERATURE))
  ? Math.max(0, Math.min(1.5, Number(process.env.OPENAI_TEMPERATURE)))
  : 0.7;
const OPENAI_MAX_TOKENS = Number.isFinite(Number(process.env.OPENAI_MAX_TOKENS))
  ? Math.max(128, Math.min(4096, Number.parseInt(process.env.OPENAI_MAX_TOKENS, 10)))
  : 900;
const SESSION_COOKIE_NAME = "lcs_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "converted", "archived", "lost"]);
const SUBSCRIPTION_STATUSES = new Set(["inactive", "trialing", "active", "past_due", "canceled", "expired", "payment_failed"]);
const DB_PAYMENT_STATUSES = new Set(["new", "process", "success", "overpaid", "underpaid", "fail", "refunded", "chargeback"]);
const GENERATION_TYPES = new Set(["text", "image", "video", "audio", "post"]);

const REQUIRED_SUPABASE_TABLES = [
  { table: "plans", probe: "id" },
  { table: "app_users", probe: "id" },
  { table: "user_profiles", probe: "user_id" },
  { table: "user_subscriptions", probe: "id" },
  { table: "payments", probe: "id" },
  { table: "leads", probe: "id" },
  { table: "generations", probe: "id" }
];

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
    setSessionCookie(req, res, token);
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
  setSessionCookie(req, res, token);

  return res.json({ token, user: publicUser });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  return res.json({ ok: true });
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

app.get("/api/generations", requireAuth, async (req, res) => {
  const typeRaw = req.query.type == null ? "" : String(req.query.type);
  const type = typeRaw ? normalizeGenerationType(typeRaw) : null;
  if (typeRaw && !type) {
    return res.status(400).json({ error: "Некорректный тип контента." });
  }

  const limit = clampInt(req.query.limit, 120, 1, 500);

  try {
    const data = await listUserGenerations(req.user.id, {
      limit,
      type
    });
    return res.json({ data });
  } catch (error) {
    console.error("[generations-list]", error);
    return res.status(500).json({ error: "Не удалось загрузить историю генераций." });
  }
});

app.post("/api/generations", requireAuth, async (req, res) => {
  const type = normalizeGenerationType(req.body.type || req.body.contentType || req.body.kind);
  const prompt = String(req.body.prompt || "").trim();
  const tone = String(req.body.tone || "").trim();
  const platform = String(req.body.platform || "").trim();

  if (!type) {
    return res.status(400).json({ error: "Выберите корректный тип контента." });
  }

  if (prompt.length < 3) {
    return res.status(400).json({ error: "Промпт должен быть не короче 3 символов." });
  }

  if (prompt.length > 4000) {
    return res.status(400).json({ error: "Промпт слишком длинный (максимум 4000 символов)." });
  }

  if (!isAiGeneratorReady()) {
    return res.status(503).json({ error: "AI генератор не настроен на сервере. Добавьте OPENAI_API_KEY." });
  }

  const planId = normalizePlanId(req.user.planId) || "free";
  if (!PLAN_CONFIG[planId].allowedTypes.includes(type)) {
    return res.status(403).json({
      error: `Формат ${toContentTypeLabel(type)} недоступен на тарифе ${PLAN_CONFIG[planId].label}.`
    });
  }

  try {
    const monthlyUsage = await getMonthlyGenerationUsage(req.user.id);
    const planLimit = planGenerationLimit(planId);
    if (planLimit !== null && monthlyUsage >= planLimit) {
      return res.status(403).json({
        error: `Лимит ${planLimit} генераций в текущем месяце для тарифа ${PLAN_CONFIG[planId].label} достигнут.`
      });
    }

    const generated = await generateWithAi({
      type,
      prompt,
      tone,
      platform
    });

    const item = await createGenerationRecord({
      userId: req.user.id,
      planId,
      type,
      prompt,
      tone,
      platform,
      title: generated.title,
      output: generated.output,
      model: generated.model || OPENAI_MODEL,
      metadata: generated.metadata
    });

    return res.status(201).json({ item });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const message = String(error?.message || "Не удалось выполнить генерацию.");
    if (status >= 500) {
      console.error("[generation-create]", error);
    }
    return res.status(status).json({ error: message });
  }
});

app.delete("/api/generations", requireAuth, async (req, res) => {
  try {
    const removed = await clearUserGenerations(req.user.id);
    return res.json({ ok: true, removed });
  } catch (error) {
    console.error("[generation-clear]", error);
    return res.status(500).json({ error: "Не удалось очистить историю генераций." });
  }
});

app.delete("/api/generations/:id", requireAuth, async (req, res) => {
  const generationId = String(req.params.id || "").trim();
  if (!generationId) {
    return res.status(400).json({ error: "Некорректный id генерации." });
  }

  try {
    const removed = await removeUserGeneration(req.user.id, generationId);
    if (!removed) {
      return res.status(404).json({ error: "Генерация не найдена." });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error("[generation-delete]", error);
    return res.status(500).json({ error: "Не удалось удалить генерацию." });
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

app.get("/app", (req, res) => {
  if (!hasValidSessionCookie(req)) {
    return res.redirect(302, "/?auth=1");
  }

  res.set("X-Robots-Tag", "noindex, nofollow");
  res.sendFile(APP_INDEX_PATH);
});

app.get("/app/", (req, res) => {
  if (!hasValidSessionCookie(req)) {
    return res.redirect(302, "/?auth=1");
  }
  res.redirect(302, "/app");
});

app.get(/^\/app\/.+/, (req, res) => {
  if (!hasValidSessionCookie(req)) {
    return res.redirect(302, "/?auth=1");
  }
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
  const token = extractAuthTokenFromRequest(req);

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

function sanitizeGeneration(row) {
  const type = normalizeGenerationType(row.type || row.contentType) || "text";
  return {
    id: row.id,
    userId: row.userId,
    type,
    prompt: row.prompt || "",
    title: row.title || defaultGenerationTitle(type, row.platform || ""),
    output: row.output || "",
    tone: row.tone || "",
    platform: row.platform || "",
    model: row.model || "",
    status: row.status || "completed",
    createdAt: row.createdAt || new Date().toISOString()
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

async function listUserGenerations(userId, options = {}) {
  const limit = clampInt(options.limit, 120, 1, 500);
  const type = options.type ? normalizeGenerationType(options.type) : null;

  if (isSupabaseReady()) {
    let query = supabase
      .from("generations")
      .select("id,user_id,content_type,prompt,tone,platform,title,output,model,status,error_text,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq("content_type", type);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`[supabase-generations-list] ${error.message}`);
    }

    return Array.isArray(data) ? data.map(mapSupabaseGenerationRow).map(sanitizeGeneration) : [];
  }

  const db = await readDb();
  let rows = db.generations.filter((entry) => entry.userId === userId);

  if (type) {
    rows = rows.filter((entry) => entry.type === type);
  }

  rows.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
  return rows.slice(0, limit).map(sanitizeGeneration);
}

async function getMonthlyGenerationUsage(userId) {
  const startIso = startOfCurrentMonthUtcIso();
  if (isSupabaseReady()) {
    const { count, error } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startIso);

    if (error) {
      throw new Error(`[supabase-generations-usage] ${error.message}`);
    }

    return Number(count || 0);
  }

  const startTs = toTimestamp(startIso);
  const db = await readDb();
  return db.generations.filter((entry) => entry.userId === userId && toTimestamp(entry.createdAt) >= startTs).length;
}

async function createGenerationRecord(payload) {
  const now = new Date().toISOString();
  const safe = {
    id: makeId(),
    userId: payload.userId,
    type: normalizeGenerationType(payload.type) || "text",
    prompt: clampText(payload.prompt || "", 4000),
    tone: clampText(payload.tone || "", 80),
    platform: clampText(payload.platform || "", 80),
    title: clampText(payload.title || "", 200),
    output: clampText(payload.output || "", 12000),
    model: clampText(payload.model || OPENAI_MODEL, 120),
    status: "completed",
    errorText: null,
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    createdAt: now
  };

  if (isSupabaseReady()) {
    const row = {
      id: safe.id,
      user_id: safe.userId,
      content_type: safe.type,
      prompt: safe.prompt,
      tone: toNullIfEmpty(safe.tone),
      platform: toNullIfEmpty(safe.platform),
      title: toNullIfEmpty(safe.title),
      output: safe.output,
      model: toNullIfEmpty(safe.model),
      status: "completed",
      error_text: null,
      metadata: {
        ...(safe.metadata || {}),
        provider: "openai",
        plan_id: payload.planId || null
      },
      created_at: safe.createdAt
    };

    const { data, error } = await supabase
      .from("generations")
      .insert(row)
      .select("id,user_id,content_type,prompt,tone,platform,title,output,model,status,error_text,created_at")
      .single();

    if (error) {
      throw new Error(`[supabase-generation-insert] ${error.message}`);
    }

    return sanitizeGeneration(mapSupabaseGenerationRow(data));
  }

  return mutateDb((db) => {
    db.generations.unshift(safe);
    return sanitizeGeneration(safe);
  });
}

async function clearUserGenerations(userId) {
  if (isSupabaseReady()) {
    const { count, error: countError } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      throw new Error(`[supabase-generation-clear-count] ${countError.message}`);
    }

    const removed = Number(count || 0);
    if (removed > 0) {
      const { error } = await supabase
        .from("generations")
        .delete()
        .eq("user_id", userId);
      if (error) {
        throw new Error(`[supabase-generation-clear] ${error.message}`);
      }
    }

    return removed;
  }

  return mutateDb((db) => {
    const before = db.generations.length;
    db.generations = db.generations.filter((entry) => entry.userId !== userId);
    return before - db.generations.length;
  });
}

async function removeUserGeneration(userId, generationId) {
  if (isSupabaseReady()) {
    const { data, error } = await supabase
      .from("generations")
      .delete()
      .eq("id", generationId)
      .eq("user_id", userId)
      .select("id");

    if (error) {
      throw new Error(`[supabase-generation-delete] ${error.message}`);
    }

    return Array.isArray(data) && data.length > 0;
  }

  return mutateDb((db) => {
    const idx = db.generations.findIndex((entry) => entry.id === generationId && entry.userId === userId);
    if (idx < 0) {
      return false;
    }
    db.generations.splice(idx, 1);
    return true;
  });
}

async function generateWithAi({ type, prompt, tone, platform }) {
  if (!isAiGeneratorReady()) {
    throw createHttpError(503, "AI генератор не настроен. Добавьте OPENAI_API_KEY.");
  }

  const system = buildGenerationSystemPrompt();
  const userPrompt = buildGenerationUserPrompt({
    type,
    prompt,
    tone,
    platform
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: OPENAI_TEMPERATURE,
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt }
        ]
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createHttpError(504, "AI генерация заняла слишком много времени. Повторите запрос.");
    }
    throw createHttpError(502, "Не удалось подключиться к AI провайдеру.");
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let payload = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    throw createHttpError(mapProviderStatusToHttp(response.status), parseOpenAiError(payload, response.status));
  }

  const outputText = extractTextFromOpenAi(payload);
  if (!outputText) {
    throw createHttpError(502, "AI провайдер вернул пустой ответ.");
  }

  const parsed = parseAiGenerationOutput(outputText, type, platform);
  return {
    ...parsed,
    model: clampText(String(payload?.model || OPENAI_MODEL), 120),
    metadata: {
      provider: "openai",
      temperature: OPENAI_TEMPERATURE
    }
  };
}

function mapSupabaseGenerationRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.content_type,
    prompt: row.prompt,
    tone: row.tone || "",
    platform: row.platform || "",
    title: row.title || "",
    output: row.output || "",
    model: row.model || "",
    status: row.status || "completed",
    errorText: row.error_text || null,
    createdAt: row.created_at || new Date().toISOString()
  };
}

function parseAiGenerationOutput(rawText, type, platform) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n").trim();
  const fallbackTitle = defaultGenerationTitle(type, platform);
  if (!normalized) {
    return {
      title: fallbackTitle,
      output: "Контент не сгенерирован. Попробуйте уточнить промпт."
    };
  }

  const titleMatch = normalized.match(/^\s*TITLE:\s*(.+)$/im);
  const contentMatch = normalized.match(/^\s*CONTENT:\s*([\s\S]+)$/im);

  let title = titleMatch ? titleMatch[1].trim() : "";
  let output = contentMatch ? contentMatch[1].trim() : normalized;

  if (!title) {
    const firstLine = output.split("\n").find((line) => line.trim());
    if (firstLine && firstLine.length <= 140) {
      title = firstLine.trim();
      output = output
        .split("\n")
        .slice(1)
        .join("\n")
        .trim() || output;
    }
  }

  return {
    title: clampText(title || fallbackTitle, 200),
    output: clampText(output || normalized, 12000)
  };
}

function buildGenerationSystemPrompt() {
  return [
    "Ты senior content strategist и копирайтер.",
    "Отвечай только на русском языке.",
    "Верни ответ строго в формате:",
    "TITLE: <краткий заголовок до 90 символов>",
    "CONTENT:",
    "<готовый контент без вводных фраз и без объяснений про модель>"
  ].join("\n");
}

function buildGenerationUserPrompt({ type, prompt, tone, platform }) {
  const safePrompt = clampText(String(prompt || "").trim(), 4000);
  const safeTone = clampText(String(tone || "нейтральный").trim(), 80);
  const safePlatform = clampText(String(platform || "универсально").trim(), 80);

  return [
    `Формат: ${toContentTypeLabel(type)}.`,
    `Платформа: ${safePlatform}.`,
    `Тон: ${safeTone}.`,
    "",
    "Требования к результату:",
    generationTypeGuideline(type),
    "",
    "Запрос пользователя:",
    safePrompt
  ].join("\n");
}

function generationTypeGuideline(type) {
  if (type === "image") {
    return "Сформируй детальный промпт для генерации изображения: сцена, свет, композиция, стиль, тех-параметры.";
  }
  if (type === "video") {
    return "Сформируй короткий видеосценарий с таймингом, хуком в начале, основной частью и CTA в конце.";
  }
  if (type === "audio") {
    return "Сформируй аудио-скрипт: структура, интонация, темп, финальный CTA, рекомендации по подложке.";
  }
  if (type === "post") {
    return "Сформируй полностью готовый пост для публикации с логичной структурой, CTA и релевантными хештегами.";
  }
  return "Сформируй структурированный, прикладной текст: сильный хук, ценность, шаги и четкий CTA.";
}

function normalizeGenerationType(value) {
  const type = String(value || "").trim().toLowerCase();
  return GENERATION_TYPES.has(type) ? type : null;
}

function defaultGenerationTitle(type, platform) {
  const map = {
    text: "Текст",
    image: "Концепт фото",
    video: "Сценарий видео",
    audio: "Аудио-скрипт",
    post: "Готовый пост"
  };
  const base = map[type] || "Генерация";
  return platform ? `${base} для ${platform}` : base;
}

function toContentTypeLabel(type) {
  const map = {
    text: "Текст",
    image: "Фото",
    video: "Видео",
    audio: "Аудио",
    post: "Готовый пост"
  };
  return map[type] || "Контент";
}

function extractTextFromOpenAi(payload) {
  const direct = payload?.choices?.[0]?.message?.content;
  if (typeof direct === "string") {
    return direct.trim();
  }

  if (Array.isArray(direct)) {
    const merged = direct
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part?.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n")
      .trim();
    if (merged) {
      return merged;
    }
  }

  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }

  return "";
}

function parseOpenAiError(payload, status) {
  const detail = String(payload?.error?.message || "").trim();
  if (status === 401 || status === 403) {
    return "OPENAI_API_KEY недействителен или не имеет доступа к модели.";
  }
  if (status === 429) {
    return "Лимит запросов к AI провайдеру достигнут. Повторите попытку позже.";
  }
  if (status >= 500) {
    return "AI провайдер временно недоступен.";
  }
  if (detail) {
    return `AI запрос отклонен: ${detail}`;
  }
  return "Не удалось получить ответ от AI провайдера.";
}

function mapProviderStatusToHttp(providerStatus) {
  if (providerStatus === 400) {
    return 400;
  }
  if (providerStatus === 401 || providerStatus === 403) {
    return 503;
  }
  if (providerStatus === 429) {
    return 429;
  }
  return 502;
}

function startOfCurrentMonthUtcIso() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return start.toISOString();
}

function isAiGeneratorReady() {
  return Boolean(OPENAI_API_KEY && OPENAI_MODEL);
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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
    await ensureSupabaseSchemaAndSeed();
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

async function readDb() {
  await ensureDb();

  if (isSupabaseReady()) {
    return readSupabaseNormalizedDb();
  }

  const raw = await fs.readFile(DB_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return normalizeDb(parsed);
  } catch (_error) {
    return createDefaultDb();
  }
}

async function writeDb(db) {
  if (isSupabaseReady()) {
    await writeSupabaseNormalizedDb(db);
    return;
  }

  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

async function ensureSupabaseSchemaAndSeed() {
  for (const item of REQUIRED_SUPABASE_TABLES) {
    const { error } = await supabase.from(item.table).select(item.probe).limit(1);
    if (error) {
      throw new Error(
        `[supabase-schema] table "${item.table}" is not ready: ${error.message}. Run supabase/schema.sql first.`
      );
    }
  }

  const planRows = Object.values(PLAN_CONFIG).map((plan, index) => {
    const limit = planGenerationLimit(plan.id);
    return {
      id: plan.id,
      name: plan.label,
      description: plan.label,
      price_monthly: Number(plan.amount || 0),
      currency: String(plan.currency || CARDLINK_CURRENCY).toUpperCase(),
      generations_per_month: limit,
      allowed_content_types: plan.allowedTypes,
      is_active: true,
      sort_order: index + 1,
      metadata: {
        checkout_available: plan.id !== "free"
      }
    };
  });

  const { error: seedError } = await supabase
    .from("plans")
    .upsert(planRows, { onConflict: "id" });

  if (seedError) {
    throw new Error(`[supabase-seed-plans] ${seedError.message}`);
  }
}

async function readSupabaseNormalizedDb() {
  const db = createDefaultDb();

  const usersRows = await fetchSupabaseRows(() =>
    supabase
      .from("app_users")
      .select("id,email,password_hash,role,status,created_at,updated_at,last_login_at,last_payment_at")
      .order("created_at", { ascending: false })
  );

  const userIds = usersRows.map((row) => row.id).filter(Boolean);

  const profileRows = userIds.length
    ? await fetchSupabaseRows(() =>
      supabase
        .from("user_profiles")
        .select("user_id,full_name,username,website,bio")
        .in("user_id", userIds)
    )
    : [];

  const subscriptionRows = userIds.length
    ? await fetchSupabaseRows(() =>
      supabase
        .from("user_subscriptions")
        .select("id,user_id,plan_id,status,is_current,created_at,updated_at,current_period_start,current_period_end")
        .in("user_id", userIds)
        .eq("is_current", true)
    )
    : [];

  const profileMap = new Map(profileRows.map((row) => [row.user_id, row]));
  const subscriptionMap = new Map(subscriptionRows.map((row) => [row.user_id, row]));

  db.users = usersRows.map((row) => {
    const profile = profileMap.get(row.id);
    const subscription = subscriptionMap.get(row.id);
    const planId = normalizePlanId(subscription?.plan_id) || "free";
    const planStatus = subscriptionStatusToPlanStatus(subscription?.status, planId);

    return {
      id: row.id,
      email: String(row.email || "").toLowerCase(),
      passwordHash: row.password_hash || "",
      role: USER_ROLES.has(String(row.role || "")) ? String(row.role) : "user",
      status: USER_STATUSES.has(String(row.status || "")) ? String(row.status) : "active",
      planId,
      planStatus,
      profile: {
        fullName: profile?.full_name || "",
        username: profile?.username || "",
        website: profile?.website || "",
        bio: profile?.bio || ""
      },
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
      lastLoginAt: row.last_login_at || null,
      lastPaymentAt: row.last_payment_at || null
    };
  });

  const paymentRows = await fetchSupabaseRows(() =>
    supabase
      .from("payments")
      .select(
        "id,user_id,plan_id,provider,provider_bill_id,provider_order_id,provider_transaction_id,amount,currency,commission,status,source,raw_payload,created_at,updated_at,paid_at,failed_at"
      )
      .order("created_at", { ascending: false })
  );

  db.payments = paymentRows.map((row) => {
    const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : null;
    const appMeta = raw?._app && typeof raw._app === "object" ? raw._app : null;
    return {
      id: row.id,
      provider: String(row.provider || "cardlink"),
      billId: row.provider_bill_id || null,
      orderId: row.provider_order_id || "",
      userId: row.user_id || null,
      planId: normalizePlanId(row.plan_id) || "free",
      amount: toNumberOrNull(row.amount),
      outSum: toNumberOrNull(appMeta?.outSum),
      commission: toNumberOrNull(row.commission),
      currency: String(row.currency || CARDLINK_CURRENCY).toUpperCase(),
      status: dbPaymentStatusToApp(row.status),
      trsId: row.provider_transaction_id || null,
      custom: typeof appMeta?.custom === "string" ? appMeta.custom : null,
      linkUrl: typeof appMeta?.linkUrl === "string" ? appMeta.linkUrl : null,
      linkPageUrl: typeof appMeta?.linkPageUrl === "string" ? appMeta.linkPageUrl : null,
      source: row.source || "unknown",
      raw: raw,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
      paidAt: row.paid_at || null,
      failedAt: row.failed_at || null
    };
  });

  const leadRows = await fetchSupabaseRows(() =>
    supabase
      .from("leads")
      .select("id,name,email,phone,company,goal,source,status,note,created_at,updated_at")
      .order("created_at", { ascending: false })
  );

  db.leads = leadRows.map((row) => ({
    id: row.id,
    name: row.name || "",
    email: String(row.email || "").toLowerCase(),
    phone: row.phone || "",
    company: row.company || "",
    goal: row.goal || "",
    source: row.source || "landing",
    status: dbLeadStatusToApp(row.status),
    note: row.note || "",
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString()
  }));

  return normalizeDb(db);
}

async function writeSupabaseNormalizedDb(db) {
  const normalized = normalizeDb(db);
  await syncSupabaseUsers(normalized.users);
  await syncSupabasePayments(normalized.payments);
  await syncSupabaseLeads(normalized.leads);
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
    leads: Array.isArray(db?.leads) ? db.leads : [],
    generations: Array.isArray(db?.generations) ? db.generations : []
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

  safe.generations = safe.generations.map((entry) => {
    const now = new Date().toISOString();
    const type = normalizeGenerationType(entry.type || entry.contentType) || "text";
    return {
      id: entry.id || makeId(),
      userId: entry.userId || "",
      type,
      prompt: clampText(String(entry.prompt || "").trim(), 4000),
      tone: clampText(String(entry.tone || "").trim(), 80),
      platform: clampText(String(entry.platform || "").trim(), 80),
      title: clampText(String(entry.title || defaultGenerationTitle(type, entry.platform || "")).trim(), 200),
      output: clampText(String(entry.output || "").trim(), 12000),
      model: clampText(String(entry.model || "").trim(), 120),
      status: "completed",
      errorText: null,
      metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
      createdAt: entry.createdAt || now
    };
  });

  safe.generations.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

  return safe;
}

function createDefaultDb() {
  return {
    users: [],
    payments: [],
    leads: [],
    generations: []
  };
}

async function fetchSupabaseRows(builderFactory, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await builderFactory().range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`[supabase-select] ${error.message}`);
    }

    if (!Array.isArray(data) || !data.length) {
      break;
    }

    rows.push(...data);
    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

async function syncSupabaseUsers(users) {
  if (!users.length) {
    return;
  }

  const now = new Date().toISOString();
  const userRows = users.map((user) => ({
    id: user.id,
    email: user.email,
    password_hash: user.passwordHash || "",
    role: mapUserRoleToDb(user.role),
    status: mapUserStatusToDb(user.status),
    created_at: user.createdAt || now,
    updated_at: user.updatedAt || now,
    last_login_at: user.lastLoginAt || null,
    last_payment_at: user.lastPaymentAt || null
  }));

  const { error: usersError } = await supabase
    .from("app_users")
    .upsert(userRows, { onConflict: "id" });
  if (usersError) {
    throw new Error(`[supabase-sync-users] ${usersError.message}`);
  }

  const profileRows = users.map((user) => ({
    user_id: user.id,
    full_name: clampText(user.profile?.fullName || "", 200),
    username: toNullIfEmpty(clampText(user.profile?.username || "", 120)),
    website: clampText(user.profile?.website || "", 300),
    bio: clampText(user.profile?.bio || "", 2000),
    updated_at: user.updatedAt || now
  }));

  const { error: profilesError } = await supabase
    .from("user_profiles")
    .upsert(profileRows, { onConflict: "user_id" });
  if (profilesError) {
    throw new Error(`[supabase-sync-profiles] ${profilesError.message}`);
  }

  const userIds = users.map((user) => user.id);
  const existingSubscriptions = await fetchSupabaseRows(() =>
    supabase
      .from("user_subscriptions")
      .select("id,user_id,current_period_start,current_period_end,created_at")
      .eq("is_current", true)
      .in("user_id", userIds)
  );
  const existingMap = new Map(existingSubscriptions.map((row) => [row.user_id, row]));

  const updateRows = users.map((user) => {
    const existing = existingMap.get(user.id);
    const planId = normalizePlanId(user.planId) || "free";
    const status = planStatusToSubscriptionStatus(user.planStatus, planId);
    const active = status === "active" || status === "trialing";

    return {
      id: existing?.id || makeId(),
      user_id: user.id,
      plan_id: planId,
      status,
      is_current: true,
      current_period_start: existing?.current_period_start || (active ? now : null),
      current_period_end: existing?.current_period_end || null,
      created_at: existing?.created_at || user.createdAt || now,
      updated_at: user.updatedAt || now
    };
  });

  const { error: subscriptionsError } = await supabase
    .from("user_subscriptions")
    .upsert(updateRows, { onConflict: "id" });
  if (subscriptionsError) {
    throw new Error(`[supabase-sync-subscriptions] ${subscriptionsError.message}`);
  }
}

async function syncSupabasePayments(payments) {
  if (!payments.length) {
    return;
  }

  const rows = payments.map((payment) => {
    const rawPayload = payment.raw && typeof payment.raw === "object" ? { ...payment.raw } : {};
    rawPayload._app = {
      outSum: toNumberOrNull(payment.outSum),
      custom: payment.custom || null,
      linkUrl: payment.linkUrl || null,
      linkPageUrl: payment.linkPageUrl || null
    };

    return {
      id: payment.id,
      user_id: payment.userId,
      plan_id: normalizePlanId(payment.planId) || "free",
      provider: mapBillingProviderToDb(payment.provider),
      provider_bill_id: payment.billId || null,
      provider_order_id: payment.orderId || "",
      provider_transaction_id: payment.trsId || null,
      amount: toNumberOrNull(payment.amount) ?? 0,
      currency: String(payment.currency || CARDLINK_CURRENCY).toUpperCase(),
      commission: toNumberOrNull(payment.commission),
      status: appPaymentStatusToDb(payment.status),
      source: payment.source || "unknown",
      raw_payload: rawPayload,
      paid_at: payment.paidAt || null,
      failed_at: payment.failedAt || null,
      created_at: payment.createdAt || new Date().toISOString(),
      updated_at: payment.updatedAt || payment.createdAt || new Date().toISOString()
    };
  });

  const { error } = await supabase
    .from("payments")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    throw new Error(`[supabase-sync-payments] ${error.message}`);
  }
}

async function syncSupabaseLeads(leads) {
  if (!leads.length) {
    return;
  }

  const rows = leads.map((lead) => ({
    id: lead.id,
    name: clampText(lead.name || "", 120),
    email: clampText(String(lead.email || "").toLowerCase(), 160),
    phone: clampText(lead.phone || "", 80),
    company: clampText(lead.company || "", 160),
    goal: clampText(lead.goal || "", 2000),
    source: clampText(lead.source || "landing", 120),
    status: appLeadStatusToDb(lead.status),
    note: clampText(lead.note || "", 2000),
    created_at: lead.createdAt || new Date().toISOString(),
    updated_at: lead.updatedAt || lead.createdAt || new Date().toISOString()
  }));

  const { error } = await supabase
    .from("leads")
    .upsert(rows, { onConflict: "id" });
  if (error) {
    throw new Error(`[supabase-sync-leads] ${error.message}`);
  }
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

function extractAuthTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (bearerToken) {
    return bearerToken;
  }

  const cookies = parseCookies(req.headers.cookie || "");
  return String(cookies[SESSION_COOKIE_NAME] || "").trim();
}

function hasValidSessionCookie(req) {
  const token = extractAuthTokenFromRequest(req);
  if (!token) {
    return false;
  }

  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch (_error) {
    return false;
  }
}

function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: SESSION_MAX_AGE_MS,
    path: "/"
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/"
  });
}

function parseCookies(cookieHeader) {
  const pairs = String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const map = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    try {
      map[key] = decodeURIComponent(value);
    } catch (_error) {
      map[key] = value;
    }
  }
  return map;
}

function isSecureRequest(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwarded === "https") {
    return true;
  }
  return req.protocol === "https";
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

function mapUserRoleToDb(value) {
  const role = String(value || "").toLowerCase();
  return USER_ROLES.has(role) ? role : "user";
}

function mapUserStatusToDb(value) {
  const status = String(value || "").toLowerCase();
  return status === "blocked" ? "blocked" : "active";
}

function mapBillingProviderToDb(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "cardlink") {
    return "cardlink";
  }
  if (provider === "manual") {
    return "manual";
  }
  return "other";
}

function dbPaymentStatusToApp(value) {
  const status = String(value || "").toLowerCase();
  const map = {
    new: "NEW",
    process: "PROCESS",
    success: "SUCCESS",
    overpaid: "OVERPAID",
    underpaid: "UNDERPAID",
    fail: "FAIL",
    refunded: "REFUNDED",
    chargeback: "CHARGEBACK"
  };
  return map[status] || "NEW";
}

function appPaymentStatusToDb(value) {
  const status = String(value || "").toUpperCase();
  const map = {
    NEW: "new",
    PROCESS: "process",
    SUCCESS: "success",
    OVERPAID: "overpaid",
    UNDERPAID: "underpaid",
    FAIL: "fail",
    REFUNDED: "refunded",
    CHARGEBACK: "chargeback"
  };
  const mapped = map[status] || "new";
  return DB_PAYMENT_STATUSES.has(mapped) ? mapped : "new";
}

function dbLeadStatusToApp(value) {
  const status = String(value || "").toLowerCase();
  return LEAD_STATUSES.has(status) ? status : "new";
}

function appLeadStatusToDb(value) {
  const status = String(value || "").toLowerCase();
  return LEAD_STATUSES.has(status) ? status : "new";
}

function subscriptionStatusToPlanStatus(value, planId) {
  const status = String(value || "").toLowerCase();
  if (!status || !SUBSCRIPTION_STATUSES.has(status)) {
    return planId === "free" ? "inactive" : "inactive";
  }
  if (status === "active" || status === "trialing") {
    return "active";
  }
  if (status === "payment_failed" || status === "past_due") {
    return "payment_failed";
  }
  return status;
}

function planStatusToSubscriptionStatus(value, planId) {
  const status = String(value || "").toLowerCase();
  if (status === "active") {
    return "active";
  }
  if (status === "payment_failed") {
    return "payment_failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  if (status === "expired") {
    return "expired";
  }
  return planId === "free" ? "inactive" : "inactive";
}

function planGenerationLimit(planId) {
  if (planId === "free") {
    return 30;
  }
  if (planId === "plus") {
    return 300;
  }
  if (planId === "pro") {
    return null;
  }
  return null;
}

function toNullIfEmpty(value) {
  const text = String(value || "").trim();
  return text ? text : null;
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

#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_DB_FILE = path.join(ROOT_DIR, "server", "data", "db.json");
const DEFAULT_CURRENCY = String(process.env.CARDLINK_CURRENCY || "RUB").toUpperCase();

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const APP_ROLES = new Set(["user", "admin"]);
const APP_USER_STATUSES = new Set(["active", "blocked", "deleted"]);
const APP_PLAN_IDS = new Set(["free", "plus", "pro"]);
const APP_PLAN_STATUSES = new Set(["inactive", "trialing", "active", "past_due", "canceled", "expired", "payment_failed"]);
const APP_PAYMENT_STATUSES = new Set(["NEW", "PROCESS", "SUCCESS", "OVERPAID", "UNDERPAID", "FAIL", "REFUNDED", "CHARGEBACK"]);
const APP_LEAD_STATUSES = new Set(["new", "contacted", "qualified", "converted", "archived", "lost"]);

const args = parseArgs(process.argv.slice(2));
const dbFile = args.file
  ? path.resolve(process.cwd(), args.file)
  : DEFAULT_DB_FILE;
const dryRun = Boolean(args["dry-run"]);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[migrate] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

void main();

async function main() {
  console.log(`[migrate] source file: ${dbFile}`);
  const localDb = await readLocalDb(dbFile);
  await ensureSchemaReady();
  await seedPlans();

  const userResult = await migrateUsers(localDb.users || []);
  const paymentResult = await migratePayments(localDb.payments || [], userResult.userIdMap);
  const leadResult = await migrateLeads(localDb.leads || []);

  console.log("[migrate] done");
  console.log(
    JSON.stringify(
      {
        dryRun,
        users: userResult.summary,
        payments: paymentResult,
        leads: leadResult
      },
      null,
      2
    )
  );
}

async function readLocalDb(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[migrate] invalid JSON in ${filePath}: ${error.message}`);
  }

  return {
    users: Array.isArray(parsed?.users) ? parsed.users : [],
    payments: Array.isArray(parsed?.payments) ? parsed.payments : [],
    leads: Array.isArray(parsed?.leads) ? parsed.leads : []
  };
}

async function ensureSchemaReady() {
  const required = [
    { table: "plans", probe: "id" },
    { table: "app_users", probe: "id" },
    { table: "user_profiles", probe: "user_id" },
    { table: "user_subscriptions", probe: "id" },
    { table: "payments", probe: "id" },
    { table: "leads", probe: "id" }
  ];

  for (const item of required) {
    const { error } = await supabase.from(item.table).select(item.probe).limit(1);
    if (error) {
      throw new Error(
        `[migrate] table '${item.table}' is not ready: ${error.message}. Run supabase/schema.sql first.`
      );
    }
  }
}

async function seedPlans() {
  const plusAmount = toFiniteNumber(process.env.PLAN_PLUS_AMOUNT, 19);
  const proAmount = toFiniteNumber(process.env.PLAN_PRO_AMOUNT, 59);

  const rows = [
    {
      id: "free",
      name: "Free",
      description: "Базовый тариф для старта",
      price_monthly: 0,
      currency: DEFAULT_CURRENCY,
      generations_per_month: 30,
      allowed_content_types: ["text", "image", "post"],
      is_active: true,
      sort_order: 1,
      metadata: { checkout_available: false }
    },
    {
      id: "plus",
      name: "Plus",
      description: "Расширенный тариф для активного создания контента",
      price_monthly: plusAmount,
      currency: DEFAULT_CURRENCY,
      generations_per_month: 300,
      allowed_content_types: ["text", "image", "video", "audio", "post"],
      is_active: true,
      sort_order: 2,
      metadata: { checkout_available: true }
    },
    {
      id: "pro",
      name: "Pro",
      description: "Максимальный тариф для команд и агентств",
      price_monthly: proAmount,
      currency: DEFAULT_CURRENCY,
      generations_per_month: null,
      allowed_content_types: ["text", "image", "video", "audio", "post"],
      is_active: true,
      sort_order: 3,
      metadata: { checkout_available: true }
    }
  ];

  if (dryRun) {
    console.log(`[migrate] dry-run: skip upsert plans (${rows.length})`);
    return;
  }

  const { error } = await supabase.from("plans").upsert(rows, { onConflict: "id" });
  if (error) {
    throw new Error(`[migrate] plans upsert failed: ${error.message}`);
  }
}

async function migrateUsers(sourceUsers) {
  const now = new Date().toISOString();
  const userIdMap = new Map();
  const emailToUuid = new Map();
  const dedupedUsers = [];

  for (const user of sourceUsers) {
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      continue;
    }

    const existingByEmail = emailToUuid.get(email);
    if (existingByEmail) {
      if (user?.id) {
        userIdMap.set(String(user.id), existingByEmail);
      }
      continue;
    }

    const uuid = ensureUuid(user?.id, `user:${email}`);
    emailToUuid.set(email, uuid);
    if (user?.id) {
      userIdMap.set(String(user.id), uuid);
    }

    dedupedUsers.push({
      id: uuid,
      email,
      passwordHash: String(user?.passwordHash || ""),
      role: normalizeRole(user?.role),
      status: normalizeUserStatus(user?.status),
      createdAt: validTimestamp(user?.createdAt) || now,
      updatedAt: validTimestamp(user?.updatedAt) || validTimestamp(user?.createdAt) || now,
      lastLoginAt: validTimestamp(user?.lastLoginAt),
      lastPaymentAt: validTimestamp(user?.lastPaymentAt),
      planId: normalizePlanId(user?.planId) || "free",
      planStatus: normalizePlanStatus(user?.planStatus),
      profile: {
        fullName: clampText(user?.profile?.fullName || "", 200),
        username: clampText(user?.profile?.username || "", 120),
        website: clampText(user?.profile?.website || "", 300),
        bio: clampText(user?.profile?.bio || "", 2000)
      }
    });
  }

  const userRows = dedupedUsers.map((user) => ({
    id: user.id,
    email: user.email,
    password_hash: user.passwordHash,
    role: user.role,
    status: user.status,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    last_login_at: user.lastLoginAt,
    last_payment_at: user.lastPaymentAt
  }));

  const profileRows = dedupedUsers.map((user) => ({
    user_id: user.id,
    full_name: user.profile.fullName,
    username: toNullIfEmpty(user.profile.username),
    website: user.profile.website,
    bio: user.profile.bio,
    updated_at: user.updatedAt
  }));

  const subscriptionRows = dedupedUsers.map((user) => ({
    id: ensureUuid(null, `subscription:${user.id}`),
    user_id: user.id,
    plan_id: user.planId,
    status: planStatusToSubscriptionStatus(user.planStatus, user.planId),
    is_current: true,
    current_period_start: user.planStatus === "active" ? user.updatedAt : null,
    current_period_end: null,
    canceled_at: user.planStatus === "canceled" ? user.updatedAt : null,
    metadata: { migrated_from_local: true },
    created_at: user.createdAt,
    updated_at: user.updatedAt
  }));

  if (dryRun) {
    console.log(
      `[migrate] dry-run: users=${userRows.length}, profiles=${profileRows.length}, subscriptions=${subscriptionRows.length}`
    );
    return {
      userIdMap,
      summary: {
        source: sourceUsers.length,
        upserted: userRows.length
      }
    };
  }

  if (userRows.length) {
    const { error } = await supabase.from("app_users").upsert(userRows, { onConflict: "id" });
    if (error) {
      throw new Error(`[migrate] app_users upsert failed: ${error.message}`);
    }
  }

  if (profileRows.length) {
    const { error } = await supabase.from("user_profiles").upsert(profileRows, { onConflict: "user_id" });
    if (error) {
      throw new Error(`[migrate] user_profiles upsert failed: ${error.message}`);
    }
  }

  if (subscriptionRows.length) {
    const userIds = subscriptionRows.map((row) => row.user_id);
    const { error: deactivateError } = await supabase
      .from("user_subscriptions")
      .update({ is_current: false, updated_at: now })
      .in("user_id", userIds)
      .eq("is_current", true);

    if (deactivateError) {
      throw new Error(`[migrate] user_subscriptions deactivate failed: ${deactivateError.message}`);
    }

    const { error } = await supabase
      .from("user_subscriptions")
      .upsert(subscriptionRows, { onConflict: "id" });

    if (error) {
      throw new Error(`[migrate] user_subscriptions upsert failed: ${error.message}`);
    }
  }

  return {
    userIdMap,
    summary: {
      source: sourceUsers.length,
      upserted: userRows.length
    }
  };
}

async function migratePayments(sourcePayments, userIdMap) {
  const rows = sourcePayments.map((payment, index) => {
    const userId = payment?.userId ? userIdMap.get(String(payment.userId)) || null : null;
    const appStatus = normalizeAppPaymentStatus(payment?.status);

    const rawPayload = payment?.raw && typeof payment.raw === "object" ? { ...payment.raw } : {};
    rawPayload._migration = {
      source: "local-db-json",
      at: new Date().toISOString(),
      outSum: toNullNumber(payment?.outSum),
      custom: payment?.custom || null,
      linkUrl: payment?.linkUrl || null,
      linkPageUrl: payment?.linkPageUrl || null
    };

    return {
      id: ensureUuid(payment?.id, `payment:${payment?.orderId || index}`),
      user_id: userId,
      subscription_id: null,
      plan_id: normalizePlanId(payment?.planId),
      provider: normalizeBillingProvider(payment?.provider),
      provider_bill_id: toNullIfEmpty(payment?.billId),
      provider_order_id: clampText(String(payment?.orderId || ""), 200),
      provider_transaction_id: toNullIfEmpty(payment?.trsId),
      amount: toFiniteNumber(payment?.amount ?? payment?.outSum, 0),
      currency: normalizeCurrency(payment?.currency),
      commission: toNullNumber(payment?.commission),
      status: appPaymentStatusToDb(appStatus),
      source: clampText(String(payment?.source || "create-bill"), 120),
      raw_payload: rawPayload,
      paid_at: validTimestamp(payment?.paidAt),
      failed_at: validTimestamp(payment?.failedAt),
      created_at: validTimestamp(payment?.createdAt) || new Date().toISOString(),
      updated_at: validTimestamp(payment?.updatedAt) || validTimestamp(payment?.createdAt) || new Date().toISOString()
    };
  });

  if (dryRun) {
    console.log(`[migrate] dry-run: payments=${rows.length}`);
    return {
      source: sourcePayments.length,
      upserted: rows.length
    };
  }

  if (rows.length) {
    const { error } = await supabase.from("payments").upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`[migrate] payments upsert failed: ${error.message}`);
    }
  }

  return {
    source: sourcePayments.length,
    upserted: rows.length
  };
}

async function migrateLeads(sourceLeads) {
  const rows = sourceLeads.map((lead, index) => ({
    id: ensureUuid(lead?.id, `lead:${lead?.email || index}`),
    workspace_id: null,
    name: clampText(lead?.name || "", 120),
    email: clampText(String(lead?.email || "").toLowerCase(), 160),
    phone: clampText(lead?.phone || "", 80),
    company: clampText(lead?.company || "", 160),
    goal: clampText(lead?.goal || "", 2000),
    source: clampText(lead?.source || "landing", 120),
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    status: normalizeLeadStatus(lead?.status),
    assigned_to: null,
    note: clampText(lead?.note || "", 2000),
    contacted_at: null,
    converted_at: normalizeLeadStatus(lead?.status) === "converted" ? validTimestamp(lead?.updatedAt) : null,
    created_at: validTimestamp(lead?.createdAt) || new Date().toISOString(),
    updated_at: validTimestamp(lead?.updatedAt) || validTimestamp(lead?.createdAt) || new Date().toISOString()
  }));

  if (dryRun) {
    console.log(`[migrate] dry-run: leads=${rows.length}`);
    return {
      source: sourceLeads.length,
      upserted: rows.length
    };
  }

  if (rows.length) {
    const { error } = await supabase.from("leads").upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`[migrate] leads upsert failed: ${error.message}`);
    }
  }

  return {
    source: sourceLeads.length,
    upserted: rows.length
  };
}

function parseArgs(rawArgs) {
  const out = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const token = rawArgs[i];
    if (token === "--dry-run") {
      out["dry-run"] = true;
      continue;
    }

    if (token === "--file") {
      out.file = rawArgs[i + 1];
      i += 1;
      continue;
    }
  }
  return out;
}

function ensureUuid(rawValue, stableSeed) {
  const value = String(rawValue || "").trim();
  if (isUuid(value)) {
    return value;
  }

  return stableUuid(stableSeed || value || `generated:${Date.now()}`);
}

function stableUuid(seed) {
  const digest = crypto.createHash("sha1").update(`lcs:${seed}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeRole(value) {
  const role = String(value || "").toLowerCase();
  return APP_ROLES.has(role) ? role : "user";
}

function normalizeUserStatus(value) {
  const status = String(value || "").toLowerCase();
  return APP_USER_STATUSES.has(status) ? status : "active";
}

function normalizePlanId(value) {
  const planId = String(value || "").toLowerCase();
  return APP_PLAN_IDS.has(planId) ? planId : null;
}

function normalizePlanStatus(value) {
  const status = String(value || "").toLowerCase();
  return APP_PLAN_STATUSES.has(status) ? status : "inactive";
}

function normalizeAppPaymentStatus(value) {
  const status = String(value || "").toUpperCase();
  return APP_PAYMENT_STATUSES.has(status) ? status : "NEW";
}

function appPaymentStatusToDb(status) {
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
  return map[status] || "new";
}

function normalizeLeadStatus(value) {
  const status = String(value || "").toLowerCase();
  return APP_LEAD_STATUSES.has(status) ? status : "new";
}

function normalizeBillingProvider(value) {
  const provider = String(value || "").toLowerCase();
  if (provider === "cardlink") {
    return "cardlink";
  }
  if (provider === "manual") {
    return "manual";
  }
  return "other";
}

function normalizeCurrency(value) {
  const currency = String(value || DEFAULT_CURRENCY).trim().toUpperCase();
  if (currency.length === 3) {
    return currency;
  }
  return DEFAULT_CURRENCY;
}

function planStatusToSubscriptionStatus(planStatus, planId) {
  const status = normalizePlanStatus(planStatus);
  if (status === "payment_failed") {
    return "payment_failed";
  }
  if (status === "active") {
    return "active";
  }
  if (status === "canceled") {
    return "canceled";
  }
  if (status === "expired") {
    return "expired";
  }
  if (status === "trialing") {
    return "trialing";
  }
  if (status === "past_due") {
    return "past_due";
  }
  return planId === "free" ? "inactive" : "inactive";
}

function validTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
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

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return Number(fallback || 0);
}

function toNullNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullIfEmpty(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}

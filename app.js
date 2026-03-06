const STORAGE_KEY = "liquid_content_studio_v3";
const API_BASE = window.LCS_API_BASE || "";

const CONTENT_TYPES = {
  text: "Текст",
  image: "Фото",
  video: "Видео",
  audio: "Аудио",
  post: "Готовый пост"
};

const PLAN_CONFIG = {
  free: {
    id: "free",
    label: "Free",
    price: "0 RUB",
    limit: 30,
    allowedTypes: ["text", "image", "post"],
    subtitle: "для старта",
    features: [
      "30 генераций в месяц",
      "Текст, фото и посты",
      "История генераций",
      "Профиль автора"
    ]
  },
  plus: {
    id: "plus",
    label: "Plus",
    price: "19 RUB",
    limit: 300,
    allowedTypes: ["text", "image", "video", "audio", "post"],
    subtitle: "в месяц",
    features: [
      "300 генераций в месяц",
      "Все форматы контента",
      "Оплата через Cardlink",
      "Расширенная история"
    ]
  },
  pro: {
    id: "pro",
    label: "Pro",
    price: "59 RUB",
    limit: Infinity,
    allowedTypes: ["text", "image", "video", "audio", "post"],
    subtitle: "в месяц",
    features: [
      "Безлимитные генерации",
      "Все форматы + максимум качества",
      "Приоритетные платежи",
      "Панель аналитики (для admin)"
    ]
  }
};

const PAYMENT_SUCCESS_STATUSES = new Set(["SUCCESS", "OVERPAID"]);
const PAYMENT_FAIL_STATUSES = new Set(["FAIL"]);

const DEFAULT_STATE = {
  selectedType: "text",
  history: [],
  latestId: null,
  usage: {},
  authToken: "",
  authMode: "login",
  profile: {
    fullName: "",
    username: "",
    email: "",
    website: "",
    bio: "",
    joinedAt: new Date().toISOString()
  }
};

const state = loadState();
let currentUser = null;
let plansMeta = {
  cardlinkReady: false,
  plans: {
    free: { checkoutAvailable: false, amount: 0, currency: "RUB" },
    plus: { checkoutAvailable: false, amount: 19, currency: "RUB" },
    pro: { checkoutAvailable: false, amount: 59, currency: "RUB" }
  }
};

let adminState = {
  overview: null,
  users: [],
  usersMeta: null,
  payments: [],
  leads: []
};

let adminSearchTimer = null;
let deferredInstallPrompt = null;
let generationInFlight = false;

const elements = {
  activePlanBadge: document.getElementById("activePlanBadge"),
  authStatusBadge: document.getElementById("authStatusBadge"),
  usageText: document.getElementById("usageText"),
  usageFill: document.getElementById("usageFill"),
  installAppBtn: document.getElementById("installAppBtn"),
  menuToggleBtn: document.getElementById("menuToggleBtn"),
  avatarMenuBtn: document.getElementById("avatarMenuBtn"),
  menuCloseBtn: document.getElementById("menuCloseBtn"),
  menuBackdrop: document.getElementById("menuBackdrop"),
  sideMenu: document.getElementById("sideMenu"),
  menuIdentity: document.getElementById("menuIdentity"),
  menuViewButtons: Array.from(document.querySelectorAll("[data-menu-view]")),
  menuHistoryButtons: Array.from(document.querySelectorAll("[data-menu-history]")),
  menuLogoutBtn: document.getElementById("menuLogoutBtn"),
  menuRefreshBillingBtn: document.getElementById("menuRefreshBillingBtn"),
  planRefreshBillingBtn: document.getElementById("planRefreshBillingBtn"),
  adminTabBtn: document.getElementById("adminTabBtn"),
  views: Array.from(document.querySelectorAll(".view")),
  typeButtons: Array.from(document.querySelectorAll(".type-btn")),
  quickActionCards: Array.from(document.querySelectorAll("[data-quick-type]")),
  suggestChips: Array.from(document.querySelectorAll("[data-suggest]")),
  modeChatBtn: document.getElementById("modeChatBtn"),
  modeVoiceBtn: document.getElementById("modeVoiceBtn"),
  selectedTypeBadge: document.getElementById("selectedTypeBadge"),
  generatorForm: document.getElementById("generatorForm"),
  generateSubmitBtn: document.querySelector("#generatorForm button[type='submit']"),
  promptInput: document.getElementById("promptInput"),
  toneSelect: document.getElementById("toneSelect"),
  platformSelect: document.getElementById("platformSelect"),
  generatorMessage: document.getElementById("generatorMessage"),
  latestOutput: document.getElementById("latestOutput"),
  historySearch: document.getElementById("historySearch"),
  historyFilter: document.getElementById("historyFilter"),
  historyList: document.getElementById("historyList"),
  historyTemplate: document.getElementById("historyItemTemplate"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  plansGrid: document.getElementById("plansGrid"),
  profileForm: document.getElementById("profileForm"),
  fullName: document.getElementById("fullName"),
  username: document.getElementById("username"),
  email: document.getElementById("email"),
  website: document.getElementById("website"),
  bio: document.getElementById("bio"),
  avatarPreview: document.getElementById("avatarPreview"),
  profileMessage: document.getElementById("profileMessage"),
  statsGrid: document.getElementById("statsGrid"),
  authLoggedOut: document.getElementById("authLoggedOut"),
  authLoggedIn: document.getElementById("authLoggedIn"),
  authModeButtons: Array.from(document.querySelectorAll(".auth-mode-btn")),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authFullName: document.getElementById("authFullName"),
  authUsername: document.getElementById("authUsername"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authMessage: document.getElementById("authMessage"),
  authIdentity: document.getElementById("authIdentity"),
  authRegisterOnly: document.querySelector(".auth-register-only"),
  logoutBtn: document.getElementById("logoutBtn"),
  manageBillingBtn: document.getElementById("manageBillingBtn"),
  billingMessage: document.getElementById("billingMessage"),
  adminRefreshBtn: document.getElementById("adminRefreshBtn"),
  adminMetricsGrid: document.getElementById("adminMetricsGrid"),
  adminUserSearch: document.getElementById("adminUserSearch"),
  adminPlanFilter: document.getElementById("adminPlanFilter"),
  adminRoleFilter: document.getElementById("adminRoleFilter"),
  adminStatusFilter: document.getElementById("adminStatusFilter"),
  adminUsersBody: document.getElementById("adminUsersBody"),
  adminPaymentStatusFilter: document.getElementById("adminPaymentStatusFilter"),
  adminPaymentsBody: document.getElementById("adminPaymentsBody"),
  adminLeadStatusFilter: document.getElementById("adminLeadStatusFilter"),
  adminLeadsBody: document.getElementById("adminLeadsBody"),
  adminMessage: document.getElementById("adminMessage")
};

init();

function init() {
  if (!state.authToken) {
    redirectToAuthGate();
    return;
  }

  bindEvents();
  setupPwa();
  applyAuthMode();
  ensureSelectedType();
  resizePromptInput();
  renderAll();
  void bootstrap();
}

function bindEvents() {
  elements.menuViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.menuView);
      closeMenu();
    });
  });

  elements.menuHistoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setHistoryFilter(button.dataset.menuHistory);
      setActiveView("history");
      closeMenu();
    });
  });

  if (elements.menuToggleBtn) {
    elements.menuToggleBtn.addEventListener("click", toggleMenu);
  }
  if (elements.avatarMenuBtn) {
    elements.avatarMenuBtn.addEventListener("click", toggleMenu);
  }
  if (elements.menuCloseBtn) {
    elements.menuCloseBtn.addEventListener("click", closeMenu);
  }
  if (elements.menuBackdrop) {
    elements.menuBackdrop.addEventListener("click", closeMenu);
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  elements.typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedType(button.dataset.type);
    });
  });

  elements.quickActionCards.forEach((card) => {
    card.addEventListener("click", () => {
      setSelectedType(card.dataset.quickType);
    });
  });

  if (elements.modeChatBtn) {
    elements.modeChatBtn.addEventListener("click", () => {
      setSelectedType("text");
    });
  }
  if (elements.modeVoiceBtn) {
    elements.modeVoiceBtn.addEventListener("click", () => {
      setSelectedType("audio");
    });
  }

  elements.suggestChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const text = String(chip.dataset.suggest || "").trim();
      if (!text) {
        return;
      }
      elements.promptInput.value = text;
      resizePromptInput();
      elements.promptInput.focus();
    });
  });

  elements.promptInput.addEventListener("input", () => {
    resizePromptInput();
  });

  elements.generatorForm.addEventListener("submit", onGenerate);

  elements.historySearch.addEventListener("input", renderHistoryList);
  elements.historyFilter.addEventListener("change", () => {
    syncHistoryMenuState();
    renderHistoryList();
  });
  elements.historyList.addEventListener("click", onHistoryAction);

  elements.clearHistoryBtn.addEventListener("click", () => {
    void onClearHistory();
  });

  elements.plansGrid.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }

    void handlePlanAction(target.dataset.action, target.dataset.plan);
  });

  elements.profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void onProfileSave();
  });

  elements.authModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      saveState();
      applyAuthMode();
    });
  });

  elements.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void onAuthSubmit();
  });

  elements.logoutBtn.addEventListener("click", () => {
    void onLogout();
  });
  if (elements.menuLogoutBtn) {
    elements.menuLogoutBtn.addEventListener("click", () => {
      void onLogout();
    });
  }
  elements.manageBillingBtn.addEventListener("click", () => {
    void refreshBillingStatus();
  });
  if (elements.menuRefreshBillingBtn) {
    elements.menuRefreshBillingBtn.addEventListener("click", () => {
      void refreshBillingStatus();
    });
  }
  if (elements.planRefreshBillingBtn) {
    elements.planRefreshBillingBtn.addEventListener("click", () => {
      void refreshBillingStatus();
    });
  }
  elements.installAppBtn.addEventListener("click", () => {
    void handleInstallClick();
  });

  if (elements.adminRefreshBtn) {
    elements.adminRefreshBtn.addEventListener("click", () => {
      void loadAdminData(true);
    });
  }

  if (elements.adminUserSearch) {
    elements.adminUserSearch.addEventListener("input", () => {
      clearTimeout(adminSearchTimer);
      adminSearchTimer = setTimeout(() => {
        void loadAdminUsers();
      }, 250);
    });
  }

  if (elements.adminPlanFilter) {
    elements.adminPlanFilter.addEventListener("change", () => {
      void loadAdminUsers();
    });
  }

  if (elements.adminRoleFilter) {
    elements.adminRoleFilter.addEventListener("change", () => {
      void loadAdminUsers();
    });
  }

  if (elements.adminStatusFilter) {
    elements.adminStatusFilter.addEventListener("change", () => {
      void loadAdminUsers();
    });
  }

  if (elements.adminPaymentStatusFilter) {
    elements.adminPaymentStatusFilter.addEventListener("change", () => {
      void loadAdminPayments();
    });
  }

  if (elements.adminLeadStatusFilter) {
    elements.adminLeadStatusFilter.addEventListener("change", () => {
      void loadAdminLeads();
    });
  }

  if (elements.adminUsersBody) {
    elements.adminUsersBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-admin-save]");
      if (!button) {
        return;
      }

      const userId = button.dataset.adminSave;
      void saveAdminUserRow(userId);
    });
  }

  if (elements.adminLeadsBody) {
    elements.adminLeadsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-admin-lead-save]");
      if (!button) {
        return;
      }

      const leadId = button.dataset.adminLeadSave;
      void saveAdminLeadRow(leadId);
    });
  }
}

function setSelectedType(type) {
  if (!CONTENT_TYPES[type]) {
    return;
  }

  if (!isTypeAllowed(type)) {
    const plan = getCurrentPlan();
    setMessage(
      elements.generatorMessage,
      `Тип \"${CONTENT_TYPES[type]}\" недоступен на тарифе ${plan.label}.`,
      "error"
    );
    return;
  }

  state.selectedType = type;
  saveState();
  renderTypeButtons();
  clearMessage(elements.generatorMessage);
}

function resizePromptInput() {
  if (!elements.promptInput) {
    return;
  }

  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 200)}px`;
}

async function bootstrap() {
  await loadPlanMeta();

  if (state.authToken) {
    await refreshCurrentUser();
    if (currentUser) {
      try {
        await loadGenerationHistory();
      } catch (error) {
        setMessage(elements.generatorMessage, error.message, "error");
      }
    }
  }

  await handleCheckoutReturn();
  ensureSelectedType();

  if (isAdmin()) {
    await loadAdminData(false);
  }

  applyViewFromUrl();
  renderAll();
}

function applyViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const allowed = new Set(["create", "history", "profile", "plan"]);
  if (isAdmin()) {
    allowed.add("admin");
  }

  if (!view || !allowed.has(view)) {
    return;
  }

  setActiveView(view);
}

function setupPwa() {
  setupInstallPrompt();
  registerServiceWorker();
}

function setupInstallPrompt() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone) {
    elements.installAppBtn.classList.add("hidden");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installAppBtn.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.installAppBtn.classList.add("hidden");
  });
}

async function handleInstallClick() {
  if (!deferredInstallPrompt) {
    setMessage(elements.generatorMessage, "Для установки откройте меню браузера и выберите «Установить приложение».", "error");
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === "accepted") {
    elements.installAppBtn.classList.add("hidden");
  }

  deferredInstallPrompt = null;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void registerServiceWorkerInternal();
  });
}

async function registerServiceWorkerInternal() {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    attachServiceWorkerUpdateHandlers(registration);
  } catch (error) {
    console.error("[pwa-sw-register]", error);
  }
}

function attachServiceWorkerUpdateHandlers(registration) {
  if (registration.waiting) {
    promptSwUpdate(registration);
  }

  registration.addEventListener("updatefound", () => {
    const nextWorker = registration.installing;
    if (!nextWorker) {
      return;
    }

    nextWorker.addEventListener("statechange", () => {
      if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
        promptSwUpdate(registration);
      }
    });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) {
      return;
    }

    refreshing = true;
    window.location.reload();
  });
}

function promptSwUpdate(registration) {
  const accept = window.confirm("Доступно обновление приложения. Обновить сейчас?");
  if (!accept) {
    return;
  }

  if (registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }
}

async function loadPlanMeta() {
  try {
    const data = await apiRequest("/api/plans", { auth: false });
    plansMeta = {
      cardlinkReady: Boolean(data.cardlinkReady),
      plans: data.plans || plansMeta.plans
    };

    hydratePlanPricesFromMeta();
  } catch (_error) {
    plansMeta = {
      cardlinkReady: false,
      plans: {
        free: { checkoutAvailable: false, amount: 0, currency: "RUB" },
        plus: { checkoutAvailable: false, amount: 19, currency: "RUB" },
        pro: { checkoutAvailable: false, amount: 59, currency: "RUB" }
      }
    };
  }
}

function hydratePlanPricesFromMeta() {
  const plus = plansMeta.plans?.plus;
  const pro = plansMeta.plans?.pro;

  if (plus?.amount != null && plus?.currency) {
    PLAN_CONFIG.plus.price = `${plus.amount} ${plus.currency}`;
  }

  if (pro?.amount != null && pro?.currency) {
    PLAN_CONFIG.pro.price = `${pro.amount} ${pro.currency}`;
  }
}

async function refreshCurrentUser() {
  try {
    const data = await apiRequest("/api/auth/me", { auth: true });
    currentUser = data.user;
    syncUserToState(currentUser);
    saveState();
  } catch (_error) {
    state.authToken = "";
    currentUser = null;
    clearProfileState();
    state.history = [];
    state.latestId = null;
    state.usage = {};
    saveState();
    redirectToAuthGate();
  }
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  if (!checkout) {
    return;
  }

  const invId = params.get("inv_id") || "";

  if (checkout === "cancel") {
    setMessage(elements.billingMessage, "Оплата отменена или не прошла.", "error");
    setActiveView("plan");
  }

  if (checkout === "success") {
    if (!invId) {
      setMessage(elements.billingMessage, "Оплата завершена, но inv_id не найден.", "error");
      setActiveView("plan");
    } else if (!state.authToken) {
      setMessage(elements.billingMessage, "Войдите в аккаунт, чтобы синхронизировать оплату.", "error");
      setActiveView("plan");
    } else {
      await pollPaymentResult(invId);
    }
  }

  params.delete("checkout");
  params.delete("inv_id");
  const suffix = params.toString();
  const next = `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", next);
}

async function pollPaymentResult(invId) {
  const maxAttempts = 7;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await apiRequest(`/api/billing/cardlink/order-status?invId=${encodeURIComponent(invId)}`, {
        auth: true
      });

      const status = String(result.payment?.status || "").toUpperCase();

      if (PAYMENT_SUCCESS_STATUSES.has(status)) {
        await refreshCurrentUser();
        renderAll();
        setMessage(elements.billingMessage, "Платеж подтвержден. Подписка активирована.", "success");
        setActiveView("plan");
        return;
      }

      if (PAYMENT_FAIL_STATUSES.has(status)) {
        setMessage(elements.billingMessage, "Платеж отклонен. Попробуйте снова.", "error");
        setActiveView("plan");
        return;
      }
    } catch (_error) {
      // игнорируем промежуточные ошибки и продолжаем polling
    }

    await sleep(1500);
  }

  await refreshCurrentUser();
  renderAll();
  setMessage(
    elements.billingMessage,
    "Платеж в обработке. Статус обновится автоматически после postback.",
    "error"
  );
  setActiveView("plan");
}

async function onAuthSubmit() {
  const mode = state.authMode;
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value.trim();
  const fullName = elements.authFullName.value.trim();
  const username = elements.authUsername.value.trim();

  if (!email || !password) {
    setMessage(elements.authMessage, "Введите email и пароль.", "error");
    return;
  }

  if (mode === "register" && password.length < 8) {
    setMessage(elements.authMessage, "Пароль должен быть минимум 8 символов.", "error");
    return;
  }

  const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload = mode === "register"
    ? { email, password, fullName, username }
    : { email, password };

  try {
    const data = await apiRequest(endpoint, {
      method: "POST",
      auth: false,
      body: payload
    });

    state.authToken = data.token;
    currentUser = data.user;
    syncUserToState(currentUser);
    try {
      await loadGenerationHistory();
    } catch (error) {
      setMessage(elements.generatorMessage, error.message, "error");
    }
    saveState();

    elements.authPassword.value = "";

    if (isAdmin()) {
      await loadAdminData(false);
    }

    renderAll();
    setActiveView("create");
    closeMenu();

    setMessage(
      elements.authMessage,
      mode === "register" ? "Аккаунт создан и выполнен вход." : "Вход выполнен.",
      "success"
    );
    clearMessage(elements.billingMessage);
  } catch (error) {
    setMessage(elements.authMessage, error.message, "error");
  }
}

async function onLogout() {
  closeMenu();

  try {
    await apiRequest("/api/auth/logout", {
      method: "POST",
      auth: true
    });
  } catch (_error) {
    // even if backend logout fails, clear local session and redirect
  }

  currentUser = null;
  state.authToken = "";
  clearProfileState();
  state.history = [];
  state.latestId = null;
  state.usage = {};
  adminState = {
    overview: null,
    users: [],
    usersMeta: null,
    payments: [],
    leads: []
  };

  saveState();
  renderAll();
  redirectToAuthGate();
}

function clearProfileState() {
  state.profile.fullName = "";
  state.profile.username = "";
  state.profile.email = "";
  state.profile.website = "";
  state.profile.bio = "";
  state.profile.joinedAt = new Date().toISOString();
}

async function onProfileSave() {
  const nextProfile = {
    fullName: elements.fullName.value.trim(),
    username: elements.username.value.trim(),
    email: elements.email.value.trim(),
    website: elements.website.value.trim(),
    bio: elements.bio.value.trim()
  };

  if (currentUser) {
    try {
      const data = await apiRequest("/api/profile", {
        method: "PATCH",
        auth: true,
        body: nextProfile
      });

      currentUser = data.user;
      syncUserToState(currentUser);
      saveState();
      renderAll();
      setMessage(elements.profileMessage, "Профиль сохранен на сервере.", "success");
      return;
    } catch (error) {
      setMessage(elements.profileMessage, error.message, "error");
      return;
    }
  }

  state.profile.fullName = nextProfile.fullName;
  state.profile.username = nextProfile.username;
  state.profile.email = nextProfile.email;
  state.profile.website = nextProfile.website;
  state.profile.bio = nextProfile.bio;
  saveState();
  renderProfile();
  renderStats();
  setMessage(elements.profileMessage, "Профиль сохранен локально. Для облака выполните вход.", "success");
}

async function handlePlanAction(action, planId) {
  clearMessage(elements.billingMessage);

  if (action === "need-auth") {
    setActiveView("profile");
    setMessage(elements.authMessage, "Чтобы оформить подписку, сначала войдите в аккаунт.", "error");
    return;
  }

  if (action === "checkout") {
    if (!planId) {
      return;
    }

    await startCheckout(planId);
    return;
  }
}

async function startCheckout(planId) {
  if (!currentUser) {
    setActiveView("plan");
    setMessage(elements.authMessage, "Сначала войдите в аккаунт.", "error");
    return;
  }

  try {
    const data = await apiRequest("/api/billing/cardlink/create-bill", {
      method: "POST",
      auth: true,
      body: { planId }
    });

    if (!data.url) {
      throw new Error("Сервер не вернул ссылку на оплату.");
    }

    window.location.href = data.url;
  } catch (error) {
    setMessage(elements.billingMessage, error.message, "error");
    setActiveView("plan");
  }
}

async function refreshBillingStatus() {
  if (!currentUser) {
    setMessage(elements.billingMessage, "Сначала выполните вход.", "error");
    return;
  }

  try {
    await refreshCurrentUser();
    renderAll();
    setMessage(elements.billingMessage, `Текущий план: ${getCurrentPlan().label}.`, "success");
  } catch (error) {
    setMessage(elements.billingMessage, error.message, "error");
  }
}

async function onGenerate(event) {
  event.preventDefault();

  if (!currentUser) {
    setActiveView("profile");
    setMessage(elements.authMessage, "Войдите в аккаунт, чтобы запускать AI-генерацию.", "error");
    setMessage(elements.generatorMessage, "Генерация доступна после входа в аккаунт.", "error");
    return;
  }

  if (generationInFlight) {
    return;
  }

  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    setMessage(elements.generatorMessage, "Введите промпт перед генерацией.", "error");
    return;
  }

  const type = state.selectedType;
  const check = canGenerate(type);
  if (!check.ok) {
    setMessage(elements.generatorMessage, check.reason, "error");
    return;
  }

  const tone = elements.toneSelect.value;
  const platform = elements.platformSelect.value;

  generationInFlight = true;
  setGenerateButtonState(true);
  setMessage(elements.generatorMessage, "Генерация запущена...", "success");

  try {
    const data = await apiRequest("/api/generations", {
      method: "POST",
      auth: true,
      body: {
        type,
        prompt,
        tone,
        platform
      }
    });

    const item = normalizeHistoryItem(data.item);
    state.history = [item, ...state.history.filter((entry) => entry.id !== item.id)];
    state.latestId = item.id;
    saveState();
    renderAll();
    setMessage(elements.generatorMessage, "Контент сгенерирован и сохранен в облачной истории.", "success");
  } catch (error) {
    setMessage(elements.generatorMessage, error.message, "error");
  } finally {
    generationInFlight = false;
    setGenerateButtonState(false);
  }
}

async function loadAdminData(forceMessage) {
  if (!isAdmin()) {
    return;
  }

  try {
    await Promise.all([loadAdminOverview(), loadAdminUsers(), loadAdminPayments(), loadAdminLeads()]);
    renderAdminPanel();

    if (forceMessage) {
      setMessage(elements.adminMessage, "Админ-данные обновлены.", "success");
    }
  } catch (error) {
    setMessage(elements.adminMessage, error.message, "error");
  }
}

async function loadAdminOverview() {
  const data = await apiRequest("/api/admin/overview", { auth: true });
  adminState.overview = data;
}

async function loadAdminUsers() {
  if (!isAdmin()) {
    return;
  }

  const params = new URLSearchParams();
  if (elements.adminUserSearch.value.trim()) {
    params.set("search", elements.adminUserSearch.value.trim());
  }
  if (elements.adminPlanFilter.value) {
    params.set("plan", elements.adminPlanFilter.value);
  }
  if (elements.adminRoleFilter.value) {
    params.set("role", elements.adminRoleFilter.value);
  }
  if (elements.adminStatusFilter.value) {
    params.set("status", elements.adminStatusFilter.value);
  }

  const query = params.toString();
  const data = await apiRequest(`/api/admin/users${query ? `?${query}` : ""}`, { auth: true });
  adminState.users = data.data || [];
  adminState.usersMeta = data.meta || null;
  renderAdminUsers();
}

async function loadAdminPayments() {
  if (!isAdmin()) {
    return;
  }

  const params = new URLSearchParams();
  if (elements.adminPaymentStatusFilter.value) {
    params.set("status", elements.adminPaymentStatusFilter.value);
  }
  params.set("limit", "80");

  const query = params.toString();
  const data = await apiRequest(`/api/admin/payments${query ? `?${query}` : ""}`, { auth: true });
  adminState.payments = data.data || [];
  renderAdminPayments();
}

async function loadAdminLeads() {
  if (!isAdmin()) {
    return;
  }

  const params = new URLSearchParams();
  if (elements.adminLeadStatusFilter?.value) {
    params.set("status", elements.adminLeadStatusFilter.value);
  }
  params.set("limit", "120");

  const query = params.toString();
  const data = await apiRequest(`/api/admin/leads${query ? `?${query}` : ""}`, { auth: true });
  adminState.leads = data.data || [];
  renderAdminLeads();
}

async function saveAdminUserRow(userId) {
  if (!isAdmin()) {
    return;
  }

  const row = elements.adminUsersBody.querySelector(`tr[data-user-id="${userId}"]`);
  if (!row) {
    return;
  }

  const planId = row.querySelector(".admin-plan-select")?.value;
  const role = row.querySelector(".admin-role-select")?.value;
  const status = row.querySelector(".admin-status-select")?.value;

  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      auth: true,
      body: { planId, role, status }
    });

    setMessage(elements.adminMessage, "Пользователь обновлен.", "success");
    await Promise.all([loadAdminOverview(), loadAdminUsers()]);
    renderAdminPanel();
  } catch (error) {
    setMessage(elements.adminMessage, error.message, "error");
  }
}

async function saveAdminLeadRow(leadId) {
  if (!isAdmin()) {
    return;
  }

  const row = elements.adminLeadsBody.querySelector(`tr[data-lead-id="${leadId}"]`);
  if (!row) {
    return;
  }

  const status = row.querySelector(".admin-lead-status-select")?.value;
  try {
    await apiRequest(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      auth: true,
      body: { status }
    });

    setMessage(elements.adminMessage, "Лид обновлен.", "success");
    await Promise.all([loadAdminOverview(), loadAdminLeads()]);
    renderAdminPanel();
  } catch (error) {
    setMessage(elements.adminMessage, error.message, "error");
  }
}

function renderAll() {
  renderTopBar();
  renderMenu();
  renderAuthPanel();
  renderTypeButtons();
  renderLatestOutput();
  renderHistoryList();
  renderPlans();
  renderProfile();
  renderStats();
  renderAdminTab();
  renderAdminPanel();
}

function renderTopBar() {
  const plan = getCurrentPlan();
  const used = getCurrentMonthUsage();
  const identity = currentUser
    ? (currentUser.profile?.fullName || currentUser.profile?.username || currentUser.email || "Аккаунт")
    : "Гость";

  elements.activePlanBadge.textContent = plan.label.toUpperCase();
  elements.authStatusBadge.textContent = identity;
  if (elements.menuIdentity) {
    elements.menuIdentity.textContent = identity;
  }

  if (plan.limit === Infinity) {
    elements.usageText.textContent = `${used} / ∞ в этом месяце`;
    elements.usageFill.style.width = "100%";
    return;
  }

  const percent = Math.min(100, Math.round((used / plan.limit) * 100));
  elements.usageText.textContent = `${used} / ${plan.limit} в этом месяце`;
  elements.usageFill.style.width = `${percent}%`;
}

function renderMenu() {
  const activeView = elements.views.find((view) => view.classList.contains("active"))?.id.replace("view-", "") || "create";
  elements.menuViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.menuView === activeView);
  });
  syncHistoryMenuState();
}

function renderAuthPanel() {
  const loggedIn = Boolean(currentUser);
  elements.authLoggedOut.classList.toggle("hidden", loggedIn);
  elements.authLoggedIn.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    const identity = currentUser.profile?.fullName || currentUser.profile?.username || currentUser.email;
    const role = currentUser.role === "admin" ? "admin" : "user";
    elements.authIdentity.textContent = `Вы вошли как ${identity} (${role}). Текущий план: ${getCurrentPlan().label}.`;
  } else {
    elements.authIdentity.textContent = "";
  }

  applyAuthMode();
}

function applyAuthMode() {
  const mode = state.authMode === "register" ? "register" : "login";

  elements.authModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });

  elements.authRegisterOnly.classList.toggle("hidden", mode !== "register");
  elements.authSubmitBtn.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
}

function renderTypeButtons() {
  const selected = state.selectedType;
  const plan = getCurrentPlan();

  elements.typeButtons.forEach((button) => {
    const type = button.dataset.type;
    const allowed = plan.allowedTypes.includes(type);

    button.classList.toggle("active", type === selected);
    button.disabled = !allowed;
    button.style.opacity = allowed ? "1" : "0.45";
    button.title = allowed ? "" : `Недоступно на тарифе ${plan.label}.`;
  });

  elements.quickActionCards.forEach((card) => {
    const type = card.dataset.quickType;
    const allowed = plan.allowedTypes.includes(type);
    card.classList.toggle("active", type === selected);
    card.disabled = !allowed;
    card.style.opacity = allowed ? "1" : "0.45";
    card.title = allowed ? "" : `Недоступно на тарифе ${plan.label}.`;
  });

  if (elements.modeChatBtn && elements.modeVoiceBtn) {
    const isVoice = selected === "audio";
    elements.modeVoiceBtn.classList.toggle("active", isVoice);
    elements.modeChatBtn.classList.toggle("active", !isVoice);
  }

  if (elements.selectedTypeBadge) {
    const badgeMap = {
      text: "Text",
      image: "Image",
      video: "Video",
      audio: "Voice",
      post: "Post"
    };
    elements.selectedTypeBadge.textContent = badgeMap[selected] || "Text";
  }
}

function renderLatestOutput() {
  const latest = getLatestItem();
  if (!latest) {
    elements.latestOutput.classList.add("empty");
    elements.latestOutput.innerHTML = "<p>Пока нет генераций. Введите запрос ниже и нажмите «Генерировать».</p>";
    return;
  }

  elements.latestOutput.classList.remove("empty");
  elements.latestOutput.innerHTML = `
    <div class="output-meta">
      <span class="chip">${escapeHtml(CONTENT_TYPES[latest.type])}</span>
      <span class="chip">${escapeHtml(latest.platform)}</span>
    </div>
    <p class="output-title">${escapeHtml(latest.title)}</p>
    <p class="output-text">${escapeHtml(latest.output)}</p>
  `;
}

function renderHistoryList() {
  const query = elements.historySearch.value.trim().toLowerCase();
  const filter = elements.historyFilter.value;

  const items = state.history.filter((item) => {
    const byType = filter === "all" ? true : item.type === filter;
    if (!byType) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = `${item.prompt} ${item.title} ${item.output}`.toLowerCase();
    return haystack.includes(query);
  });

  elements.historyList.innerHTML = "";
  if (!items.length) {
    elements.historyList.innerHTML = '<p class="empty-history">Ничего не найдено.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const node = elements.historyTemplate.content.cloneNode(true);
    const root = node.querySelector(".history-item");
    const chip = node.querySelector(".chip");
    const time = node.querySelector("time");
    const prompt = node.querySelector(".history-prompt");
    const output = node.querySelector(".history-output");
    const copyBtn = node.querySelector(".copy-btn");
    const deleteBtn = node.querySelector(".delete-btn");

    root.dataset.id = item.id;
    chip.textContent = CONTENT_TYPES[item.type];
    time.textContent = formatDate(item.createdAt);
    prompt.textContent = `Промпт: ${item.prompt}`;
    output.textContent = item.output;

    copyBtn.dataset.id = item.id;
    deleteBtn.dataset.id = item.id;

    fragment.appendChild(node);
  });

  elements.historyList.appendChild(fragment);
}

async function onHistoryAction(event) {
  const copyButton = event.target.closest(".copy-btn");
  if (copyButton) {
    const id = copyButton.dataset.id;
    const item = state.history.find((entry) => entry.id === id);
    if (!item) {
      return;
    }

    await copyText(item.output);
    copyButton.textContent = "Скопировано";
    setTimeout(() => {
      copyButton.textContent = "Копировать";
    }, 1300);
    return;
  }

  const deleteButton = event.target.closest(".delete-btn");
  if (!deleteButton) {
    return;
  }

  const id = deleteButton.dataset.id;
  try {
    if (currentUser) {
      await apiRequest(`/api/generations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        auth: true
      });
    }

    state.history = state.history.filter((item) => item.id !== id);
    if (state.latestId === id) {
      state.latestId = state.history[0]?.id || null;
    }

    saveState();
    renderAll();
  } catch (error) {
    setMessage(elements.generatorMessage, error.message, "error");
  }
}

async function onClearHistory() {
  if (!state.history.length) {
    return;
  }

  const accepted = window.confirm("Очистить всю историю генераций?");
  if (!accepted) {
    return;
  }

  try {
    if (currentUser) {
      await apiRequest("/api/generations", {
        method: "DELETE",
        auth: true
      });
    }

    state.history = [];
    state.latestId = null;
    saveState();
    renderAll();
    setMessage(elements.generatorMessage, "История генераций очищена.", "success");
  } catch (error) {
    setMessage(elements.generatorMessage, error.message, "error");
  }
}

function renderPlans() {
  const currentPlanId = getCurrentPlanId();

  elements.plansGrid.innerHTML = Object.values(PLAN_CONFIG)
    .map((plan) => {
      const isCurrent = currentPlanId === plan.id;
      const checkoutAvailable = Boolean(plansMeta.plans?.[plan.id]?.checkoutAvailable);

      const actionMarkup = buildPlanAction({
        plan,
        isCurrent,
        checkoutAvailable
      });

      return `
        <article class="plan-card ${isCurrent ? "current" : ""}">
          <div>
            <h3>${plan.label}</h3>
            <p class="plan-price">${plan.price}</p>
            <p class="plan-sub">${plan.subtitle}</p>
          </div>
          <ul class="plan-features">
            ${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
          </ul>
          ${actionMarkup}
        </article>
      `;
    })
    .join("");
}

function buildPlanAction({ plan, isCurrent, checkoutAvailable }) {
  if (isCurrent) {
    return '<button class="ghost-btn plan-btn" disabled>Текущий план</button>';
  }

  if (!currentUser) {
    return '<button class="primary-btn plan-btn" data-action="need-auth">Войти для оплаты</button>';
  }

  if (plan.id === "free") {
    return '<button class="ghost-btn plan-btn" disabled>Free включен по умолчанию</button>';
  }

  if (!checkoutAvailable || !plansMeta.cardlinkReady) {
    return '<button class="ghost-btn plan-btn" disabled>Cardlink не настроен</button>';
  }

  return `<button class="primary-btn plan-btn" data-action="checkout" data-plan="${plan.id}">Оплатить через Cardlink</button>`;
}

function renderProfile() {
  elements.fullName.value = state.profile.fullName || "";
  elements.username.value = state.profile.username || "";
  elements.email.value = state.profile.email || "";
  elements.website.value = state.profile.website || "";
  elements.bio.value = state.profile.bio || "";

  const initials = getInitials(state.profile.fullName || state.profile.username || "LC");
  elements.avatarPreview.textContent = initials;
}

function renderStats() {
  const total = state.history.length;
  const currentMonth = getCurrentMonthUsage();
  const favoriteType = getFavoriteTypeLabel();
  const joinDate = formatDate(state.profile.joinedAt, { month: "short", year: "numeric" });

  const cards = [
    { label: "Всего генераций", value: String(total) },
    { label: "За текущий месяц", value: String(currentMonth) },
    { label: "Любимый формат", value: favoriteType },
    { label: "С нами с", value: joinDate }
  ];

  elements.statsGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <p class="stat-label">${escapeHtml(card.label)}</p>
          <p class="stat-value">${escapeHtml(card.value)}</p>
        </article>
      `
    )
    .join("");
}

function renderAdminTab() {
  const show = isAdmin();
  elements.adminTabBtn.classList.toggle("hidden", !show);
  const adminViewIsActive = document.getElementById("view-admin")?.classList.contains("active");
  if (!show && adminViewIsActive) {
    setActiveView("create");
  }
}

function renderAdminPanel() {
  if (!isAdmin()) {
    return;
  }

  renderAdminMetrics();
  renderAdminUsers();
  renderAdminPayments();
  renderAdminLeads();
}

function renderAdminMetrics() {
  if (!elements.adminMetricsGrid) {
    return;
  }

  const data = adminState.overview;
  if (!data) {
    elements.adminMetricsGrid.innerHTML = `
      <article class="stat-card"><p class="stat-label">Данные</p><p class="stat-value">-</p></article>
      <article class="stat-card"><p class="stat-label">Загрузка</p><p class="stat-value">...</p></article>
      <article class="stat-card"><p class="stat-label">Пользователи</p><p class="stat-value">-</p></article>
      <article class="stat-card"><p class="stat-label">Выручка</p><p class="stat-value">-</p></article>
    `;
    return;
  }

  const cards = [
    { label: "Всего клиентов", value: String(data.users.totalUsers) },
    { label: "Платные клиенты", value: String(data.users.paidUsers) },
    { label: "Лиды (всего)", value: String(data.leads?.totalLeads || 0) },
    { label: "Лиды за 30 дней", value: String(data.leads?.newLeads30d || 0) },
    { label: "Выручка (месяц)", value: formatMoney(data.payments.revenueThisMonth) },
    { label: "Выручка (всего)", value: formatMoney(data.payments.revenueTotal) },
    { label: "Успешные платежи", value: String(data.payments.successfulPayments) },
    { label: "Платежи в процессе", value: String(data.payments.processingPayments) },
    { label: "Новые пользователи 30д", value: String(data.users.newUsers30d) },
    { label: "Заблокированные", value: String(data.users.blockedUsers) }
  ];

  elements.adminMetricsGrid.innerHTML = cards
    .map((card) => `
      <article class="stat-card">
        <p class="stat-label">${escapeHtml(card.label)}</p>
        <p class="stat-value">${escapeHtml(card.value)}</p>
      </article>
    `)
    .join("");
}

function renderAdminUsers() {
  if (!elements.adminUsersBody) {
    return;
  }

  const rows = adminState.users;
  if (!rows.length) {
    elements.adminUsersBody.innerHTML = '<tr><td colspan="6">Пользователи не найдены.</td></tr>';
    return;
  }

  elements.adminUsersBody.innerHTML = rows
    .map((user) => {
      const displayName = user.profile?.fullName || user.profile?.username || "Без имени";
      const statusOptions = [
        { value: "active", label: "active" },
        { value: "blocked", label: "blocked" }
      ]
        .map((option) => `<option value="${option.value}" ${user.status === option.value ? "selected" : ""}>${option.label}</option>`)
        .join("");

      const planOptions = ["free", "plus", "pro"]
        .map((planId) => `<option value="${planId}" ${user.planId === planId ? "selected" : ""}>${planId}</option>`)
        .join("");

      const roleOptions = ["user", "admin"]
        .map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${role}</option>`)
        .join("");

      return `
        <tr data-user-id="${escapeHtml(user.id)}">
          <td>
            <div class="admin-row-user">
              <strong>${escapeHtml(displayName)}</strong>
              <span>${escapeHtml(user.email)}</span>
              <span>Оплат: ${escapeHtml(String(user.successfulPayments || 0))} | Сумма: ${escapeHtml(formatMoney(user.totalPaid || 0))}</span>
            </div>
          </td>
          <td>
            <select class="admin-role-select">${roleOptions}</select>
          </td>
          <td>
            <select class="admin-plan-select">${planOptions}</select>
          </td>
          <td>
            <select class="admin-status-select">${statusOptions}</select>
          </td>
          <td>${escapeHtml(formatDate(user.createdAt, { dateStyle: "medium" }))}</td>
          <td>
            <button class="ghost-btn" data-admin-save="${escapeHtml(user.id)}">Сохранить</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminPayments() {
  if (!elements.adminPaymentsBody) {
    return;
  }

  const rows = adminState.payments;
  if (!rows.length) {
    elements.adminPaymentsBody.innerHTML = '<tr><td colspan="6">Платежи не найдены.</td></tr>';
    return;
  }

  elements.adminPaymentsBody.innerHTML = rows
    .map((payment) => {
      return `
        <tr>
          <td>${escapeHtml(formatDate(payment.updatedAt))}</td>
          <td>
            <div class="admin-row-user">
              <strong>${escapeHtml(payment.userName || "-")}</strong>
              <span>${escapeHtml(payment.userEmail || "-")}</span>
            </div>
          </td>
          <td>${escapeHtml(payment.planId || "-")}</td>
          <td>${escapeHtml(formatMoney(payment.outSum || payment.amount || 0))}</td>
          <td>${escapeHtml(payment.status || "-")}</td>
          <td>${escapeHtml(payment.orderId || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminLeads() {
  if (!elements.adminLeadsBody) {
    return;
  }

  const rows = adminState.leads;
  if (!rows.length) {
    elements.adminLeadsBody.innerHTML = '<tr><td colspan="6">Лиды не найдены.</td></tr>';
    return;
  }

  const statuses = ["new", "contacted", "qualified", "converted", "archived", "lost"];

  elements.adminLeadsBody.innerHTML = rows
    .map((lead) => {
      const statusOptions = statuses
        .map((status) => `<option value="${status}" ${lead.status === status ? "selected" : ""}>${status}</option>`)
        .join("");
      const goal = lead.goal ? lead.goal.slice(0, 120) : "-";

      return `
        <tr data-lead-id="${escapeHtml(lead.id)}">
          <td>${escapeHtml(formatDate(lead.createdAt))}</td>
          <td>
            <div class="admin-row-user">
              <strong>${escapeHtml(lead.name || "-")}</strong>
              <span>${escapeHtml(lead.email || "-")}</span>
              <span>${escapeHtml(lead.phone || "-")}</span>
            </div>
          </td>
          <td>${escapeHtml(lead.company || "-")}</td>
          <td>${escapeHtml(goal)}</td>
          <td>
            <select class="admin-lead-status-select">${statusOptions}</select>
          </td>
          <td>
            <button class="ghost-btn" data-admin-lead-save="${escapeHtml(lead.id)}">Сохранить</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function setActiveView(viewId) {
  if (!viewId) {
    return;
  }

  if (viewId === "admin" && !isAdmin()) {
    viewId = "create";
  }

  const targetId = `view-${viewId}`;
  const hasTarget = elements.views.some((view) => view.id === targetId);
  if (!hasTarget) {
    return;
  }

  elements.views.forEach((view) => {
    view.classList.toggle("active", view.id === targetId);
  });

  elements.menuViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.menuView === viewId);
  });

  if (viewId === "history") {
    syncHistoryMenuState();
  }

  if (viewId === "admin" && isAdmin() && !adminState.overview) {
    void loadAdminData(false);
  }
}

function openMenu() {
  if (!elements.sideMenu || !elements.menuBackdrop) {
    return;
  }
  elements.sideMenu.classList.add("open");
  elements.sideMenu.setAttribute("aria-hidden", "false");
  elements.menuBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeMenu() {
  if (!elements.sideMenu || !elements.menuBackdrop) {
    return;
  }
  elements.sideMenu.classList.remove("open");
  elements.sideMenu.setAttribute("aria-hidden", "true");
  elements.menuBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
}

function toggleMenu() {
  if (!elements.sideMenu) {
    return;
  }
  if (elements.sideMenu.classList.contains("open")) {
    closeMenu();
    return;
  }
  openMenu();
}

function setHistoryFilter(filter) {
  const normalized = CONTENT_TYPES[filter] ? filter : "all";
  elements.historyFilter.value = normalized;
  syncHistoryMenuState();
  renderHistoryList();
}

function syncHistoryMenuState() {
  const current = elements.historyFilter?.value || "all";
  elements.menuHistoryButtons.forEach((button) => {
    button.classList.toggle("active", (button.dataset.menuHistory || "all") === current);
  });
}

function canGenerate(type) {
  if (!currentUser) {
    return {
      ok: false,
      reason: "Войдите в аккаунт, чтобы использовать AI-генератор."
    };
  }

  const plan = getCurrentPlan();

  if (!plan.allowedTypes.includes(type)) {
    return {
      ok: false,
      reason: `На тарифе ${plan.label} недоступен формат ${CONTENT_TYPES[type]}.`
    };
  }

  const used = getCurrentMonthUsage();
  if (plan.limit !== Infinity && used >= plan.limit) {
    return {
      ok: false,
      reason: `Лимит ${plan.limit} генераций в месяце на тарифе ${plan.label} достигнут.`
    };
  }

  return { ok: true };
}

function ensureSelectedType() {
  const plan = getCurrentPlan();
  if (plan.allowedTypes.includes(state.selectedType)) {
    return;
  }

  state.selectedType = plan.allowedTypes[0];
  saveState();
}

function isTypeAllowed(type) {
  return getCurrentPlan().allowedTypes.includes(type);
}

function getCurrentMonthUsage() {
  const currentKey = monthKey();
  return state.history.filter((item) => monthKey(new Date(item.createdAt)) === currentKey).length;
}

function getCurrentPlanId() {
  if (!currentUser) {
    return "free";
  }

  return normalizePlanId(currentUser.planId) || "free";
}

function getCurrentPlan() {
  return PLAN_CONFIG[getCurrentPlanId()] || PLAN_CONFIG.free;
}

function getLatestItem() {
  if (!state.history.length) {
    return null;
  }

  if (!state.latestId) {
    return state.history[0];
  }

  return state.history.find((item) => item.id === state.latestId) || state.history[0];
}

function getFavoriteTypeLabel() {
  if (!state.history.length) {
    return "-";
  }

  const stats = state.history.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  const topType = Object.entries(stats)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  return CONTENT_TYPES[topType] || "-";
}

function syncUserToState(user) {
  state.profile.fullName = user.profile?.fullName || "";
  state.profile.username = user.profile?.username || "";
  state.profile.email = user.email || "";
  state.profile.website = user.profile?.website || "";
  state.profile.bio = user.profile?.bio || "";
  state.profile.joinedAt = user.createdAt || state.profile.joinedAt || new Date().toISOString();

  ensureSelectedType();
}

async function loadGenerationHistory() {
  if (!currentUser) {
    return;
  }

  const data = await apiRequest("/api/generations?limit=500", { auth: true });
  const items = Array.isArray(data.data) ? data.data.map(normalizeHistoryItem) : [];
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  state.history = items;
  state.latestId = items[0]?.id || null;
  saveState();
}

function normalizeHistoryItem(item) {
  const type = String(item?.type || "").toLowerCase();
  return {
    id: String(item?.id || makeId()),
    type: CONTENT_TYPES[type] ? type : "text",
    prompt: String(item?.prompt || "").trim(),
    title: String(item?.title || "").trim() || "Без названия",
    output: String(item?.output || "").trim(),
    tone: String(item?.tone || "").trim(),
    platform: String(item?.platform || "").trim() || "General",
    model: String(item?.model || "").trim(),
    status: String(item?.status || "").trim() || "completed",
    createdAt: item?.createdAt || new Date().toISOString()
  };
}

function setGenerateButtonState(loading) {
  if (!elements.generateSubmitBtn) {
    return;
  }

  elements.generateSubmitBtn.disabled = loading;
  elements.generateSubmitBtn.classList.toggle("loading", Boolean(loading));
  elements.generateSubmitBtn.setAttribute("aria-label", loading ? "Генерируем..." : "Сгенерировать");
  elements.generateSubmitBtn.title = loading ? "Генерируем..." : "Сгенерировать";
}

function redirectToAuthGate() {
  const next = `${window.location.origin}/?auth=1`;
  if (window.location.href !== next) {
    window.location.replace(next);
  }
}

function isAdmin() {
  return Boolean(currentUser && currentUser.role === "admin");
}

async function apiRequest(endpoint, options = {}) {
  const method = options.method || "GET";
  const auth = options.auth !== false;
  const body = options.body;

  const headers = {};
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  if (auth && state.authToken) {
    headers.Authorization = `Bearer ${state.authToken}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (_error) {
    throw new Error("Backend недоступен. Запустите сервер: npm run dev");
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || "Ошибка запроса к серверу.");
  }

  return data;
}

function normalizePlanId(value) {
  const planId = String(value || "").toLowerCase();
  return PLAN_CONFIG[planId] ? planId : null;
}

function monthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatDate(value, options) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const formatter = new Intl.DateTimeFormat("ru-RU", options || {
    dateStyle: "medium",
    timeStyle: "short"
  });

  return formatter.format(date);
}

function formatMoney(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0 RUB";
  }

  return `${numeric.toFixed(2)} RUB`;
}

function getInitials(source) {
  return source
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 2) || "LC";
}

function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneDefaultState();
    }

    const parsed = JSON.parse(raw);
    const safe = {
      ...cloneDefaultState(),
      ...parsed,
      profile: {
        ...cloneDefaultState().profile,
        ...(parsed.profile || {})
      }
    };

    if (!Array.isArray(safe.history)) {
      safe.history = [];
    } else {
      safe.history = safe.history.map(normalizeHistoryItem);
    }

    if (!safe.profile.joinedAt) {
      safe.profile.joinedAt = new Date().toISOString();
    }

    if (safe.authMode !== "login" && safe.authMode !== "register") {
      safe.authMode = "login";
    }

    return safe;
  } catch (_error) {
    return cloneDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clearMessage(element) {
  if (!element) {
    return;
  }

  element.textContent = "";
  element.className = "message";
}

function setMessage(element, text, type) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.className = `message ${type}`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_error) {
    const helper = document.createElement("textarea");
    helper.value = value;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

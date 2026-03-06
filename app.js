const STORAGE_KEY = "liquid_content_studio_v3";
const API_BASE = window.LCS_API_BASE || "";

const CONTENT_TYPES = {
  text: "Текст",
  image: "Фото",
  video: "Видео",
  audio: "Аудио",
  post: "Готовый пост"
};

const PROMPT_PLACEHOLDERS = {
  text: "Опишите, о чем написать текст...",
  image: "Опишите изображение для генерации...",
  video: "Опишите видео для генерации...",
  audio: "Введите текст для озвучки...",
  post: "Опишите тему для поста..."
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
  profileTab: "general",
  history: [],
  latestId: null,
  usage: {},
  notifications: {
    news: true,
    tips: true
  },
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
  mobileMenuBtn: document.getElementById("mobileMenuBtn"),
  mobileNavSheet: document.getElementById("mobileNavSheet"),
  mobileNavBackdrop: document.getElementById("mobileNavBackdrop"),
  navViewButtons: Array.from(document.querySelectorAll("[data-nav-view]")),
  adminTabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  views: Array.from(document.querySelectorAll(".view")),
  typeButtons: Array.from(document.querySelectorAll(".type-btn")),
  quickActionCards: Array.from(document.querySelectorAll("[data-quick-type]")),
  quickSearchActionBtn: document.querySelector("[data-quick-action='search']"),
  quickPresentationActionBtn: document.querySelector("[data-quick-action='presentation']"),
  quickCodeActionBtn: document.querySelector("[data-quick-action='code']"),
  suggestChips: Array.from(document.querySelectorAll("[data-suggest]")),
  selectedTypeBadge: document.getElementById("selectedTypeBadge"),
  generatorForm: document.getElementById("generatorForm"),
  generateSubmitBtn: document.querySelector("#generatorForm button[type='submit']"),
  generateSendIcon: document.querySelector("#generatorForm .send-icon"),
  generateMicIcon: document.querySelector("#generatorForm .mic-icon"),
  promptInput: document.getElementById("promptInput"),
  toneSelect: document.getElementById("toneSelect"),
  platformSelect: document.getElementById("platformSelect"),
  generatorMessage: document.getElementById("generatorMessage"),
  latestOutput: document.getElementById("latestOutput"),
  loadingState: document.getElementById("loadingState"),
  welcomeLogo: document.querySelector(".welcome-logo"),
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
  profileHeroBlock: document.getElementById("profileHeroBlock"),
  profileLayoutBlock: document.getElementById("profileLayoutBlock"),
  profileBackBtn: document.getElementById("profileBackBtn"),
  profileDisplayName: document.getElementById("profileDisplayName"),
  profileDisplayEmail: document.getElementById("profileDisplayEmail"),
  profileRoleBadge: document.getElementById("profileRoleBadge"),
  profileTabButtons: Array.from(document.querySelectorAll("[data-profile-tab]")),
  profileTabPanels: Array.from(document.querySelectorAll("[data-profile-panel]")),
  profileAdminAccessBtn: document.getElementById("profileAdminAccessBtn"),
  profileCurrentPlanName: document.getElementById("profileCurrentPlanName"),
  profileCurrentPlanPrice: document.getElementById("profileCurrentPlanPrice"),
  profilePlanFeatures: document.getElementById("profilePlanFeatures"),
  profileCancelPlanBtn: document.getElementById("profileCancelPlanBtn"),
  updatePasswordBtn: document.getElementById("updatePasswordBtn"),
  securityCurrentPassword: document.getElementById("securityCurrentPassword"),
  securityNewPassword: document.getElementById("securityNewPassword"),
  securityConfirmPassword: document.getElementById("securityConfirmPassword"),
  securityMessage: document.getElementById("securityMessage"),
  notifyNews: document.getElementById("notifyNews"),
  notifyTips: document.getElementById("notifyTips"),
  saveNotificationsBtn: document.getElementById("saveNotificationsBtn"),
  notificationMessage: document.getElementById("notificationMessage"),
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
  profileSubscriptionBtn: document.getElementById("profileSubscriptionBtn"),
  billingMessage: document.getElementById("billingMessage"),
  adminRefreshBtn: document.getElementById("adminRefreshBtn"),
  adminMetricsGrid: document.getElementById("adminMetricsGrid"),
  adminRecentUsersBody: document.getElementById("adminRecentUsersBody"),
  adminBackBtn: document.getElementById("adminBackBtn"),
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
  bindEvents();
  setupPwa();
  applyAuthMode();
  ensureSelectedType();
  resizePromptInput();
  updateComposerButtonState();
  renderAll();
  if (!state.authToken) {
    setActiveView("profile");
  }
  void bootstrap();
}

function bindEvents() {
  elements.navViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView(button.dataset.navView);
      closeMobileNav();
    });
  });

  if (elements.mobileMenuBtn) {
    elements.mobileMenuBtn.addEventListener("click", toggleMobileNav);
  }
  if (elements.mobileNavBackdrop) {
    elements.mobileNavBackdrop.addEventListener("click", closeMobileNav);
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMobileNav();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeMobileNav();
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

  if (elements.quickSearchActionBtn) {
    elements.quickSearchActionBtn.addEventListener("click", () => {
      setSelectedType("text");
      elements.promptInput.placeholder = "Что вы хотите найти?";
      elements.promptInput.focus();
    });
  }

  if (elements.quickPresentationActionBtn) {
    elements.quickPresentationActionBtn.addEventListener("click", () => {
      setSelectedType("text");
      if (!elements.promptInput.value.trim()) {
        elements.promptInput.value = "Сделай структуру презентации на тему: ";
        resizePromptInput();
      }
      elements.promptInput.focus();
      elements.promptInput.setSelectionRange(elements.promptInput.value.length, elements.promptInput.value.length);
    });
  }

  if (elements.quickCodeActionBtn) {
    elements.quickCodeActionBtn.addEventListener("click", () => {
      setSelectedType("text");
      if (!elements.promptInput.value.trim()) {
        elements.promptInput.value = "Напиши код для: ";
        resizePromptInput();
      }
      elements.promptInput.focus();
      elements.promptInput.setSelectionRange(elements.promptInput.value.length, elements.promptInput.value.length);
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

  if (elements.promptInput) {
    elements.promptInput.addEventListener("input", () => {
      resizePromptInput();
      updateComposerButtonState();
    });

    elements.promptInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      if (!elements.promptInput.value.trim() || !elements.generatorForm) {
        return;
      }

      elements.generatorForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  if (elements.generatorForm) {
    elements.generatorForm.addEventListener("submit", onGenerate);
  }

  if (elements.historySearch && elements.historyFilter && elements.historyList) {
    elements.historySearch.addEventListener("input", renderHistoryList);
    elements.historyFilter.addEventListener("change", renderHistoryList);
    elements.historyList.addEventListener("click", onHistoryAction);
  }

  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener("click", () => {
      void onClearHistory();
    });
  }

  if (elements.plansGrid) {
    elements.plansGrid.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-action]");
      if (!target) {
        return;
      }

      void handlePlanAction(target.dataset.action, target.dataset.plan);
    });
  }

  if (elements.profileForm) {
    elements.profileForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void onProfileSave();
    });
  }

  elements.profileTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setProfileTab(button.dataset.profileTab);
    });
  });

  if (elements.profileBackBtn) {
    elements.profileBackBtn.addEventListener("click", () => {
      setActiveView("create");
    });
  }

  elements.authModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      saveState();
      applyAuthMode();
    });
  });

  if (elements.authForm) {
    elements.authForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void onAuthSubmit();
    });
  }

  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener("click", () => {
      void onLogout();
    });
  }

  if (elements.profileSubscriptionBtn) {
    elements.profileSubscriptionBtn.addEventListener("click", () => {
      setProfileTab("subscription");
      elements.plansGrid?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (elements.profileCancelPlanBtn) {
    elements.profileCancelPlanBtn.addEventListener("click", () => {
      setMessage(
        elements.billingMessage,
        "Для отмены подписки напишите в поддержку. Авто-отмена появится в следующем релизе.",
        "error"
      );
    });
  }

  if (elements.profileAdminAccessBtn) {
    elements.profileAdminAccessBtn.addEventListener("click", () => {
      if (isAdmin()) {
        setActiveView("admin");
      }
    });
  }

  if (elements.updatePasswordBtn) {
    elements.updatePasswordBtn.addEventListener("click", () => {
      void onPasswordUpdate();
    });
  }

  if (elements.saveNotificationsBtn) {
    elements.saveNotificationsBtn.addEventListener("click", onSaveNotificationSettings);
  }

  if (elements.installAppBtn) {
    elements.installAppBtn.addEventListener("click", () => {
      void handleInstallClick();
    });
  }

  if (elements.adminBackBtn) {
    elements.adminBackBtn.addEventListener("click", () => {
      setActiveView("profile");
    });
  }

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

function setProfileTab(tabId, options = {}) {
  const allowedTabs = new Set(["general", "security", "subscription", "notifications"]);
  const target = allowedTabs.has(tabId) ? tabId : "general";
  const persist = options.persist !== false;

  elements.profileTabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.profileTab === target);
  });

  elements.profileTabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.profilePanel === target);
  });

  if (persist) {
    state.profileTab = target;
    saveState();
  }
}

function openSubscriptionView() {
  setActiveView("profile");
  setProfileTab("subscription");
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
  updateComposerButtonState();
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
  const profileTab = params.get("profileTab");
  const allowed = new Set(["create", "profile"]);
  if (isAdmin()) {
    allowed.add("admin");
  }

  if (!view) {
    return;
  }

  if (view === "plan") {
    openSubscriptionView();
    return;
  }

  if (!allowed.has(view)) {
    return;
  }

  setActiveView(view);
  if (view === "profile" && profileTab) {
    setProfileTab(profileTab);
  }
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
    renderAll();
    setActiveView("profile");
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
    openSubscriptionView();
  }

  if (checkout === "success") {
    if (!invId) {
      setMessage(elements.billingMessage, "Оплата завершена, но inv_id не найден.", "error");
      openSubscriptionView();
    } else if (!state.authToken) {
      setMessage(elements.billingMessage, "Войдите в аккаунт, чтобы синхронизировать оплату.", "error");
      openSubscriptionView();
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
        openSubscriptionView();
        return;
      }

      if (PAYMENT_FAIL_STATUSES.has(status)) {
        setMessage(elements.billingMessage, "Платеж отклонен. Попробуйте снова.", "error");
        openSubscriptionView();
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
  openSubscriptionView();
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
  setActiveView("profile");
  setMessage(elements.authMessage, "Вы вышли из аккаунта.", "success");
}

function clearProfileState() {
  state.profileTab = "general";
  state.profile.fullName = "";
  state.profile.username = "";
  state.profile.email = "";
  state.profile.website = "";
  state.profile.bio = "";
  state.profile.joinedAt = new Date().toISOString();
  state.notifications.news = true;
  state.notifications.tips = true;
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

async function onPasswordUpdate() {
  const currentPassword = elements.securityCurrentPassword?.value.trim() || "";
  const newPassword = elements.securityNewPassword?.value.trim() || "";
  const confirmPassword = elements.securityConfirmPassword?.value.trim() || "";

  clearMessage(elements.securityMessage);

  if (!currentPassword || !newPassword || !confirmPassword) {
    setMessage(elements.securityMessage, "Заполните все поля для смены пароля.", "error");
    return;
  }

  if (newPassword.length < 8) {
    setMessage(elements.securityMessage, "Новый пароль должен быть не короче 8 символов.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    setMessage(elements.securityMessage, "Подтверждение пароля не совпадает.", "error");
    return;
  }

  try {
    const data = await apiRequest("/api/auth/password", {
      method: "POST",
      auth: true,
      body: { currentPassword, newPassword }
    });

    if (data?.token) {
      state.authToken = data.token;
    }
    if (data?.user) {
      currentUser = data.user;
      syncUserToState(currentUser);
      renderTopBar();
      renderProfile();
    }
    saveState();

    if (elements.securityCurrentPassword) {
      elements.securityCurrentPassword.value = "";
    }
    if (elements.securityNewPassword) {
      elements.securityNewPassword.value = "";
    }
    if (elements.securityConfirmPassword) {
      elements.securityConfirmPassword.value = "";
    }

    setMessage(elements.securityMessage, "Пароль успешно обновлен.", "success");
  } catch (error) {
    setMessage(elements.securityMessage, error.message, "error");
  }
}

function onSaveNotificationSettings() {
  state.notifications.news = Boolean(elements.notifyNews?.checked);
  state.notifications.tips = Boolean(elements.notifyTips?.checked);
  saveState();
  setMessage(elements.notificationMessage, "Настройки уведомлений сохранены.", "success");
}

async function handlePlanAction(action, planId) {
  clearMessage(elements.billingMessage);

  if (action === "need-auth") {
    openSubscriptionView();
    setMessage(elements.profileMessage, "Чтобы оформить подписку, сначала войдите в аккаунт.", "error");
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
    openSubscriptionView();
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
    openSubscriptionView();
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
    setProfileTab("general");
    setMessage(elements.authMessage, "Войдите в аккаунт, чтобы запускать AI-генерацию.", "error");
    setMessage(elements.profileMessage, "Войдите в аккаунт, чтобы запускать AI-генерацию.", "error");
    setMessage(elements.generatorMessage, "Генерация доступна после входа в аккаунт.", "error");
    return;
  }

  if (generationInFlight) {
    return;
  }

  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    clearMessage(elements.generatorMessage);
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
  renderNavigation();
  renderAuthPanel();
  renderTypeButtons();
  updateComposerButtonState();
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

  if (elements.activePlanBadge) {
    elements.activePlanBadge.textContent = plan.label.toUpperCase();
  }
  elements.authStatusBadge.textContent = identity;

  if (plan.limit === Infinity) {
    elements.usageText.textContent = `${used} / ∞ в этом месяце`;
    elements.usageFill.style.width = "100%";
    return;
  }

  const percent = Math.min(100, Math.round((used / plan.limit) * 100));
  elements.usageText.textContent = `${used} / ${plan.limit} в этом месяце`;
  elements.usageFill.style.width = `${percent}%`;
}

function renderNavigation() {
  const activeView = elements.views.find((view) => view.classList.contains("active"))?.id.replace("view-", "") || "create";
  const loggedIn = Boolean(currentUser);
  elements.navViewButtons.forEach((button) => {
    if (button.hasAttribute("data-nav-internal")) {
      button.classList.add("hidden");
      return;
    }

    const viewId = button.dataset.navView;
    const hiddenForGuest = !loggedIn && (viewId === "create" || viewId === "history" || viewId === "admin");
    const hiddenForRole = viewId === "admin" && !isAdmin();
    const hidden = hiddenForGuest || hiddenForRole;

    button.classList.toggle("hidden", hidden);
    button.classList.toggle("active", !hidden && viewId === activeView);
  });
}

function renderAuthPanel() {
  const loggedIn = Boolean(currentUser);
  if (elements.authLoggedOut) {
    elements.authLoggedOut.classList.toggle("hidden", loggedIn);
  }
  if (elements.authLoggedIn) {
    elements.authLoggedIn.classList.toggle("hidden", !loggedIn);
  }
  if (elements.profileHeroBlock) {
    elements.profileHeroBlock.classList.toggle("hidden", !loggedIn);
  }
  if (elements.profileLayoutBlock) {
    elements.profileLayoutBlock.classList.toggle("hidden", !loggedIn);
  }

  if (loggedIn) {
    const identity = currentUser.profile?.fullName || currentUser.profile?.username || currentUser.email;
    const role = currentUser.role === "admin" ? "admin" : "user";
    if (elements.authIdentity) {
      elements.authIdentity.textContent = `Вы вошли как ${identity} (${role}). Текущий план: ${getCurrentPlan().label}.`;
    }
  } else {
    if (elements.authIdentity) {
      elements.authIdentity.textContent = "";
    }
  }

  applyAuthMode();
}

function applyAuthMode() {
  const mode = state.authMode === "register" ? "register" : "login";

  elements.authModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });

  if (elements.authRegisterOnly) {
    elements.authRegisterOnly.classList.toggle("hidden", mode !== "register");
  }
  if (elements.authSubmitBtn) {
    elements.authSubmitBtn.textContent = mode === "register" ? "Создать аккаунт" : "Войти";
  }
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

  if (elements.selectedTypeBadge) {
    const badgeMap = {
      text: "Текст",
      image: "Картинка",
      video: "Видео",
      audio: "Аудио",
      post: "Пост"
    };
    elements.selectedTypeBadge.textContent = badgeMap[selected] || "Текст";
  }

  if (elements.promptInput) {
    elements.promptInput.placeholder = PROMPT_PLACEHOLDERS[selected] || "Спросите что угодно...";
  }
}

function renderLatestOutput() {
  updateLoadingState(generationInFlight);

  if (!elements.latestOutput) {
    return;
  }

  if (generationInFlight) {
    elements.latestOutput.classList.add("empty");
    elements.latestOutput.innerHTML = "";
    return;
  }

  const latest = getLatestItem();
  if (elements.welcomeLogo) {
    elements.welcomeLogo.classList.toggle("hidden", Boolean(latest));
  }
  if (!latest) {
    elements.latestOutput.classList.add("empty");
    elements.latestOutput.innerHTML = "";
    return;
  }

  elements.latestOutput.classList.remove("empty");

  const mediaUrl = extractMediaUrl(latest.output);
  let contentMarkup = `<p class="output-text">${escapeHtml(latest.output)}</p>`;

  if (latest.type === "image" && mediaUrl) {
    contentMarkup = `<img class="output-media" src="${escapeHtml(mediaUrl)}" alt="Generated image" />`;
  } else if (latest.type === "video" && mediaUrl) {
    contentMarkup = `<video class="output-media" controls playsinline src="${escapeHtml(mediaUrl)}"></video>`;
  } else if (latest.type === "audio" && mediaUrl) {
    contentMarkup = `<audio controls src="${escapeHtml(mediaUrl)}"></audio>`;
  }

  elements.latestOutput.innerHTML = contentMarkup;
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
  if (!elements.plansGrid) {
    return;
  }

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
  if (elements.fullName) {
    elements.fullName.value = state.profile.fullName || "";
  }
  if (elements.username) {
    elements.username.value = state.profile.username || "";
  }
  if (elements.email) {
    elements.email.value = state.profile.email || currentUser?.email || "";
  }
  if (elements.website) {
    elements.website.value = state.profile.website || "";
  }
  if (elements.bio) {
    elements.bio.value = state.profile.bio || "";
  }

  const displayName = state.profile.fullName || state.profile.username || "Пользователь";
  const displayEmail = state.profile.email || currentUser?.email || "-";
  const roleBadge = isAdmin() ? "Администратор" : `Пользователь ${getCurrentPlan().label}`;
  const initials = getInitials(state.profile.fullName || state.profile.username || displayEmail || "WI");

  if (elements.avatarPreview) {
    elements.avatarPreview.textContent = initials;
  }
  if (elements.profileDisplayName) {
    elements.profileDisplayName.textContent = displayName;
  }
  if (elements.profileDisplayEmail) {
    elements.profileDisplayEmail.textContent = displayEmail;
  }
  if (elements.profileRoleBadge) {
    elements.profileRoleBadge.textContent = roleBadge;
  }

  if (elements.profileCurrentPlanName) {
    elements.profileCurrentPlanName.textContent = getCurrentPlan().label;
  }
  if (elements.profileCurrentPlanPrice) {
    elements.profileCurrentPlanPrice.textContent = getCurrentPlan().price;
  }
  if (elements.profilePlanFeatures) {
    elements.profilePlanFeatures.innerHTML = getCurrentPlan().features
      .map((feature) => `<li>${escapeHtml(feature)}</li>`)
      .join("");
  }

  if (elements.notifyNews) {
    elements.notifyNews.checked = Boolean(state.notifications.news);
  }
  if (elements.notifyTips) {
    elements.notifyTips.checked = Boolean(state.notifications.tips);
  }

  setProfileTab(state.profileTab || "general", { persist: false });
}

function renderStats() {
  if (!elements.statsGrid) {
    return;
  }

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
  elements.adminTabButtons.forEach((button) => {
    const internal = button.hasAttribute("data-nav-internal");
    button.classList.toggle("hidden", internal || !show);
  });
  if (elements.profileAdminAccessBtn) {
    elements.profileAdminAccessBtn.classList.toggle("hidden", !show);
  }
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
  renderAdminRecentUsers();
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
      <article class="stat-card"><p class="stat-label">Всего пользователей</p><p class="stat-value">-</p></article>
      <article class="stat-card"><p class="stat-label">Генераций за сегодня</p><p class="stat-value">-</p></article>
      <article class="stat-card"><p class="stat-label">Активные подписки (Pro)</p><p class="stat-value">-</p></article>
    `;
    return;
  }

  const cards = [
    { label: "Всего пользователей", value: String(data.users?.totalUsers || 0) },
    { label: "Генераций за сегодня", value: String(data.generations?.generationsToday || 0) },
    { label: "Активные подписки (Pro)", value: String(data.users?.activeProUsers || 0) }
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

function renderAdminRecentUsers() {
  if (!elements.adminRecentUsersBody) {
    return;
  }

  const toTs = (value) => {
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  const rows = [...adminState.users]
    .sort((a, b) => toTs(b.createdAt) - toTs(a.createdAt))
    .slice(0, 8);

  if (!rows.length) {
    elements.adminRecentUsersBody.innerHTML = '<tr><td colspan="4">Пользователи не найдены.</td></tr>';
    return;
  }

  elements.adminRecentUsersBody.innerHTML = rows
    .map((user) => {
      const name = user.profile?.fullName || user.profile?.username || "Без имени";
      const plan = normalizePlanId(user.planId) || "free";
      const planLabel = plan === "pro" ? "Pro" : plan === "plus" ? "Plus" : "Free";
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(user.email || "-")}</td>
          <td><span class="admin-plan-badge ${escapeHtml(plan)}">${escapeHtml(planLabel)}</span></td>
          <td>${escapeHtml(formatDate(user.createdAt, { dateStyle: "medium" }))}</td>
        </tr>
      `;
    })
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

  if (viewId === "history") {
    viewId = "create";
  }

  if (!currentUser && viewId !== "profile") {
    viewId = "profile";
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

  elements.navViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.navView === viewId);
  });

  if (viewId === "profile") {
    setProfileTab(state.profileTab || "general", { persist: false });
  }

  if (viewId === "admin" && isAdmin() && !adminState.overview) {
    void loadAdminData(false);
  }
}

function openMobileNav() {
  if (!elements.mobileNavSheet || !elements.mobileNavBackdrop) {
    return;
  }

  elements.mobileNavSheet.classList.add("open");
  elements.mobileNavSheet.setAttribute("aria-hidden", "false");
  elements.mobileNavBackdrop.classList.remove("hidden");
}

function closeMobileNav() {
  if (!elements.mobileNavSheet || !elements.mobileNavBackdrop) {
    return;
  }

  elements.mobileNavSheet.classList.remove("open");
  elements.mobileNavSheet.setAttribute("aria-hidden", "true");
  elements.mobileNavBackdrop.classList.add("hidden");
}

function toggleMobileNav() {
  if (!elements.mobileNavSheet) {
    return;
  }

  if (elements.mobileNavSheet.classList.contains("open")) {
    closeMobileNav();
    return;
  }

  openMobileNav();
}

function setHistoryFilter(filter) {
  const normalized = CONTENT_TYPES[filter] ? filter : "all";
  elements.historyFilter.value = normalized;
  renderHistoryList();
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
    updateLoadingState(loading);
    return;
  }

  elements.generateSubmitBtn.disabled = loading;
  elements.generateSubmitBtn.classList.toggle("loading", Boolean(loading));
  elements.generateSubmitBtn.setAttribute("aria-label", loading ? "Генерируем..." : "Сгенерировать");
  elements.generateSubmitBtn.title = loading ? "Генерируем..." : "Сгенерировать";
  updateComposerButtonState();
  updateLoadingState(loading);
}

function updateComposerButtonState() {
  if (!elements.generateSubmitBtn) {
    return;
  }

  const hasPrompt = Boolean(elements.promptInput?.value.trim());
  const canSend = hasPrompt && !generationInFlight;

  elements.generateSubmitBtn.classList.toggle("can-send", canSend);
  elements.generateSubmitBtn.disabled = generationInFlight;
  elements.generateSubmitBtn.setAttribute("aria-label", canSend ? "Отправить" : "Голосовой ввод");
  elements.generateSubmitBtn.title = canSend ? "Отправить" : "Голосовой ввод";

  if (elements.generateSendIcon) {
    elements.generateSendIcon.classList.toggle("hidden", !canSend);
  }
  if (elements.generateMicIcon) {
    elements.generateMicIcon.classList.toggle("hidden", canSend);
  }
}

function updateLoadingState(loading) {
  if (elements.loadingState) {
    elements.loadingState.classList.toggle("hidden", !loading);
  }
  if (elements.welcomeLogo) {
    elements.welcomeLogo.classList.toggle("hidden", loading);
  }
}

function extractMediaUrl(value) {
  const text = String(value || "");
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) {
    return "";
  }
  return match[0];
}

function redirectToAuthGate() {
  setActiveView("profile");
  setProfileTab("general", { persist: false });
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
      },
      notifications: {
        ...cloneDefaultState().notifications,
        ...(parsed.notifications || {})
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

    if (!["general", "security", "subscription", "notifications"].includes(safe.profileTab)) {
      safe.profileTab = "general";
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

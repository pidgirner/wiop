const STORAGE_KEY = "liquid_content_studio_v3";

const yearNode = document.getElementById("year");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobileMenu = document.getElementById("mobileMenu");
const menuIcon = document.getElementById("menuIcon");
const closeIcon = document.getElementById("closeIcon");

const authModal = document.getElementById("authModal");
const authBackdrop = document.getElementById("authBackdrop");
const authClose = document.getElementById("authClose");
const authOpenButtons = Array.from(document.querySelectorAll("[data-auth-open]"));

const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authError = document.getElementById("authError");
const authSubmit = document.getElementById("authSubmit");
const authSwitchBtn = document.getElementById("authSwitchBtn");
const authSwitchText = document.getElementById("authSwitchText");
const registerFields = document.getElementById("registerFields");
const modeLogin = document.getElementById("modeLogin");
const modeRegister = document.getElementById("modeRegister");

const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authFullName = document.getElementById("authFullName");
const authUsername = document.getElementById("authUsername");

const leadForm = document.getElementById("leadForm");
const leadMessage = document.getElementById("leadMessage");

let authMode = "login";

if (yearNode) {
  yearNode.textContent = String(new Date().getFullYear());
}

if (window.lucide && typeof window.lucide.createIcons === "function") {
  window.lucide.createIcons();
}

if (mobileMenuBtn && mobileMenu) {
  mobileMenuBtn.addEventListener("click", () => {
    const isOpen = !mobileMenu.classList.contains("hidden");
    mobileMenu.classList.toggle("hidden", isOpen);

    if (menuIcon) {
      menuIcon.classList.toggle("hidden", !isOpen);
    }
    if (closeIcon) {
      closeIcon.classList.toggle("hidden", isOpen);
    }
  });

  document.querySelectorAll("[data-menu-link]").forEach((link) => {
    link.addEventListener("click", () => {
      mobileMenu.classList.add("hidden");
      if (menuIcon) {
        menuIcon.classList.remove("hidden");
      }
      if (closeIcon) {
        closeIcon.classList.add("hidden");
      }
    });
  });
}

authOpenButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openAuth("login");
  });
});

if (authClose) {
  authClose.addEventListener("click", closeAuth);
}

if (authBackdrop) {
  authBackdrop.addEventListener("click", closeAuth);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && authModal && authModal.classList.contains("show")) {
    closeAuth();
  }
});

if (modeLogin) {
  modeLogin.addEventListener("click", () => setMode("login"));
}

if (modeRegister) {
  modeRegister.addEventListener("click", () => setMode("register"));
}

if (authSwitchBtn) {
  authSwitchBtn.addEventListener("click", () => {
    setMode(authMode === "login" ? "register" : "login");
  });
}

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth();
  });
}

const params = new URLSearchParams(window.location.search);
if (params.get("auth") === "1") {
  openAuth("login");
}

function openAuth(mode = "login") {
  setMode(mode);
  clearAuthError();

  if (!authModal) {
    return;
  }

  authModal.classList.add("show");
  authModal.classList.remove("hidden");
  document.body.classList.add("no-scroll");

  if (authEmail) {
    authEmail.focus();
  }
}

function closeAuth() {
  if (!authModal) {
    return;
  }

  authModal.classList.remove("show");
  authModal.classList.add("hidden");
  document.body.classList.remove("no-scroll");
}

function setMode(mode) {
  authMode = mode === "register" ? "register" : "login";

  if (registerFields) {
    registerFields.classList.toggle("hidden", authMode !== "register");
  }

  if (modeLogin) {
    modeLogin.className = authMode === "login"
      ? "rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
      : "rounded-lg px-3 py-2 text-sm font-medium text-slate-500";
  }

  if (modeRegister) {
    modeRegister.className = authMode === "register"
      ? "rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
      : "rounded-lg px-3 py-2 text-sm font-medium text-slate-500";
  }

  if (authTitle) {
    authTitle.textContent = authMode === "login" ? "С возвращением" : "Создать аккаунт";
  }

  if (authSubtitle) {
    authSubtitle.textContent = authMode === "login"
      ? "Войдите, чтобы продолжить работу в WIOP"
      : "Присоединяйтесь к платформе для креаторов";
  }

  if (authSubmit) {
    authSubmit.textContent = authMode === "login" ? "Войти" : "Зарегистрироваться";
  }

  if (authSwitchText) {
    authSwitchText.textContent = authMode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?";
  }

  if (authSwitchBtn) {
    authSwitchBtn.textContent = authMode === "login" ? "Зарегистрироваться" : "Войти";
  }

  clearAuthError();
}

async function submitAuth() {
  const email = String(authEmail?.value || "").trim();
  const password = String(authPassword?.value || "").trim();
  const fullName = String(authFullName?.value || "").trim();
  const username = String(authUsername?.value || "").trim();

  if (!email || !password) {
    showAuthError("Заполните email и пароль.");
    return;
  }

  if (authMode === "register") {
    if (!fullName || !username) {
      showAuthError("Для регистрации заполните имя и username.");
      return;
    }

    if (password.length < 8) {
      showAuthError("Пароль должен быть минимум 8 символов.");
      return;
    }
  }

  const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload = authMode === "register"
    ? { email, password, fullName, username }
    : { email, password };

  if (authSubmit) {
    authSubmit.disabled = true;
    authSubmit.textContent = "Подождите...";
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || "Ошибка авторизации.");
    }

    if (!data?.token) {
      throw new Error("Сервер не вернул токен.");
    }

    persistAuthState(data.token, data.user || null);
    window.location.href = "/app";
  } catch (error) {
    showAuthError(error.message || "Произошла ошибка.");
    if (authSubmit) {
      authSubmit.textContent = authMode === "login" ? "Войти" : "Зарегистрироваться";
    }
  } finally {
    if (authSubmit) {
      authSubmit.disabled = false;
    }
  }
}

function persistAuthState(token, user) {
  const defaultState = {
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

  let state = defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = {
        ...defaultState,
        ...parsed,
        profile: {
          ...defaultState.profile,
          ...(parsed.profile || {})
        }
      };
    }
  } catch (_error) {
    state = defaultState;
  }

  state.authToken = String(token || "");
  state.authMode = "login";

  if (user && typeof user === "object") {
    state.profile.fullName = user.profile?.fullName || state.profile.fullName;
    state.profile.username = user.profile?.username || state.profile.username;
    state.profile.email = user.email || state.profile.email;
    state.profile.website = user.profile?.website || state.profile.website;
    state.profile.bio = user.profile?.bio || state.profile.bio;
    state.profile.joinedAt = user.createdAt || state.profile.joinedAt || new Date().toISOString();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showAuthError(message) {
  if (!authError) {
    return;
  }

  authError.textContent = message;
  authError.classList.remove("hidden");
}

function clearAuthError() {
  if (!authError) {
    return;
  }

  authError.textContent = "";
  authError.classList.add("hidden");
}

if (leadForm) {
  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = leadForm.querySelector('button[type="submit"]');
    const urlParams = new URLSearchParams(window.location.search);
    const utmSource = urlParams.get("utm_source") || "";
    const utmMedium = urlParams.get("utm_medium") || "";
    const utmCampaign = urlParams.get("utm_campaign") || "";

    const payload = {
      name: String(document.getElementById("leadName")?.value || "").trim(),
      email: String(document.getElementById("leadEmail")?.value || "").trim(),
      phone: String(document.getElementById("leadPhone")?.value || "").trim(),
      company: String(document.getElementById("leadCompany")?.value || "").trim(),
      goal: String(document.getElementById("leadGoal")?.value || "").trim(),
      source: [utmSource, utmMedium, utmCampaign].filter(Boolean).join("|") || "landing"
    };

    if (!payload.name || !payload.email) {
      setLeadMessage("Заполните имя и email.", "error");
      return;
    }

    try {
      if (submitButton) {
        submitButton.disabled = true;
      }

      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось отправить заявку.");
      }

      setLeadMessage("Спасибо! Заявка получена. Мы свяжемся с вами в ближайшее время.", "success");
      leadForm.reset();
    } catch (error) {
      setLeadMessage(error.message || "Ошибка отправки.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function setLeadMessage(text, mode) {
  if (!leadMessage) {
    return;
  }

  leadMessage.textContent = text;
  leadMessage.className = `lead-message ${mode}`;
}

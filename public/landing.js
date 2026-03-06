const STORAGE_KEY = "liquid_content_studio_v3";

const leadForm = document.getElementById("leadForm");
const leadMessage = document.getElementById("leadMessage");
const yearNode = document.getElementById("year");
const revealNodes = Array.from(document.querySelectorAll("[data-reveal]"));
const heroVisual = document.getElementById("heroVisual");

const authModal = document.getElementById("authModal");
const authOpenButtons = Array.from(document.querySelectorAll("[data-auth-open]"));
const authCloseButtons = Array.from(document.querySelectorAll("[data-auth-close]"));
const authModeButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authFullName = document.getElementById("authFullName");
const authUsername = document.getElementById("authUsername");
const authSubmit = document.getElementById("authSubmit");
const authMessage = document.getElementById("authMessage");
const registerFields = document.getElementById("registerFields");

let authMode = "login";

if (yearNode) {
  yearNode.textContent = new Date().getFullYear().toString();
}

setupRevealAnimations();
setupHeroMotion();
setupLeadForm();
setupAuthModal();
handleInitialAuthIntent();

function setupLeadForm() {
  if (!leadForm) {
    return;
  }

  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = leadForm.querySelector('button[type="submit"]');
    const params = new URLSearchParams(window.location.search);
    const utmSource = params.get("utm_source") || "";
    const utmMedium = params.get("utm_medium") || "";
    const utmCampaign = params.get("utm_campaign") || "";

    const payload = {
      name: document.getElementById("leadName")?.value?.trim() || "",
      email: document.getElementById("leadEmail")?.value?.trim() || "",
      phone: document.getElementById("leadPhone")?.value?.trim() || "",
      company: document.getElementById("leadCompany")?.value?.trim() || "",
      goal: document.getElementById("leadGoal")?.value?.trim() || "",
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
      setLeadMessage(error.message, "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function setupAuthModal() {
  if (!authModal || !authForm) {
    return;
  }

  authOpenButtons.forEach((button) => {
    button.addEventListener("click", () => openAuthModal("login"));
  });

  authCloseButtons.forEach((button) => {
    button.addEventListener("click", closeAuthModal);
  });

  authModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authMode || "login");
    });
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuthForm();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !authModal.hidden) {
      closeAuthModal();
    }
  });
}

function handleInitialAuthIntent() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  if (auth === "1" || auth === "login") {
    openAuthModal("login");
  }
}

function openAuthModal(mode) {
  if (!authModal) {
    return;
  }

  setAuthMode(mode || "login");
  clearAuthMessage();
  authModal.hidden = false;
  authModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (authEmail) {
    authEmail.focus();
  }
}

function closeAuthModal() {
  if (!authModal) {
    return;
  }

  authModal.hidden = true;
  authModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  authModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === authMode);
  });

  if (registerFields) {
    registerFields.classList.toggle("hidden", authMode !== "register");
  }

  if (authSubmit) {
    authSubmit.textContent = authMode === "register" ? "Создать аккаунт" : "Войти";
  }
}

async function submitAuthForm() {
  const email = String(authEmail?.value || "").trim();
  const password = String(authPassword?.value || "").trim();
  const fullName = String(authFullName?.value || "").trim();
  const username = String(authUsername?.value || "").trim();

  if (!email || !password) {
    setAuthMessage("Введите email и пароль.", "error");
    return;
  }

  if (authMode === "register" && password.length < 8) {
    setAuthMessage("Пароль должен быть минимум 8 символов.", "error");
    return;
  }

  const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const payload = authMode === "register"
    ? { email, password, fullName, username }
    : { email, password };

  try {
    if (authSubmit) {
      authSubmit.disabled = true;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || "Не удалось выполнить вход.");
    }

    if (!data?.token) {
      throw new Error("Сервер не вернул токен авторизации.");
    }

    persistAuthState(data.token, data.user || null);
    setAuthMessage("Успешно. Переходим в приложение...", "success");

    setTimeout(() => {
      window.location.href = "/app";
    }, 260);
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    if (authSubmit) {
      authSubmit.disabled = false;
    }
  }
}

function persistAuthState(token, user) {
  const fallback = {
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

  let state = fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state = {
      ...fallback,
      ...parsed,
      profile: {
        ...fallback.profile,
        ...(parsed.profile || {})
      }
    };
  } catch (_error) {
    state = fallback;
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

function setupRevealAnimations() {
  if (!revealNodes.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    revealNodes.forEach((node) => node.classList.add("in-view"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("in-view");
        obs.unobserve(entry.target);
      });
    },
    {
      root: null,
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.12
    }
  );

  revealNodes.forEach((node) => observer.observe(node));
}

function setupHeroMotion() {
  if (!heroVisual || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  heroVisual.addEventListener("pointermove", (event) => {
    const rect = heroVisual.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const rx = (0.5 - py) * 5;
    const ry = (px - 0.5) * 6;
    heroVisual.style.transform = `perspective(860px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  });

  heroVisual.addEventListener("pointerleave", () => {
    heroVisual.style.transform = "perspective(860px) rotateX(0deg) rotateY(0deg)";
  });
}

function setLeadMessage(text, mode) {
  if (!leadMessage) {
    return;
  }

  leadMessage.textContent = text;
  leadMessage.className = `lead-message ${mode}`;
}

function clearAuthMessage() {
  setAuthMessage("", "");
}

function setAuthMessage(text, mode) {
  if (!authMessage) {
    return;
  }

  authMessage.textContent = text;
  authMessage.className = mode ? `auth-message ${mode}` : "auth-message";
}

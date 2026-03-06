const leadForm = document.getElementById("leadForm");
const leadMessage = document.getElementById("leadMessage");
const yearNode = document.getElementById("year");
const heroStage = document.getElementById("heroStage");
const revealNodes = Array.from(document.querySelectorAll("[data-reveal]"));

if (yearNode) {
  yearNode.textContent = new Date().getFullYear().toString();
}

setupRevealAnimations();
setupHeroStageMotion();

if (leadForm) {
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
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        entry.target.classList.add("in-view");
        obs.unobserve(entry.target);
      }
    },
    {
      root: null,
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.12
    }
  );

  revealNodes.forEach((node) => observer.observe(node));
}

function setupHeroStageMotion() {
  if (!heroStage) {
    return;
  }

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (media.matches) {
    return;
  }

  let rafId = null;

  heroStage.addEventListener("pointermove", (event) => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      const rect = heroStage.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      const rotateY = (px - 0.5) * 8;
      const rotateX = (0.5 - py) * 7;
      heroStage.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
    });
  });

  heroStage.addEventListener("pointerleave", () => {
    heroStage.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)";
  });
}

function setLeadMessage(text, mode) {
  if (!leadMessage) {
    return;
  }

  leadMessage.textContent = text;
  leadMessage.className = `lead-message ${mode}`;
}

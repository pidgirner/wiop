const leadForm = document.getElementById("leadForm");
const leadMessage = document.getElementById("leadMessage");
const yearNode = document.getElementById("year");

if (yearNode) {
  yearNode.textContent = new Date().getFullYear().toString();
}

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

function setLeadMessage(text, mode) {
  if (!leadMessage) {
    return;
  }

  leadMessage.textContent = text;
  leadMessage.className = `lead-message ${mode}`;
}

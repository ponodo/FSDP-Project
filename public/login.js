(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // already signed in? skip the form
  fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((u) => {
    if (u) location.replace(u.role === "Admin" ? "index.html" : "portal.html");
  }).catch(() => {});

  const alertBox = (m, ok) => ($("alert").innerHTML = m ? `<div class="alert ${ok ? "ok" : ""}">${esc(m)}</div>` : "");
  const fieldErr = (id, m) => {
    const f = $("f-" + id);
    f.classList.toggle("bad", !!m);
    f.querySelector(".msg").textContent = m || "";
  };

  document.querySelectorAll("[data-eye]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = $(b.dataset.eye);
      i.type = i.type === "password" ? "text" : "password";
      b.setAttribute("aria-label", i.type === "password" ? "Show password" : "Hide password");
    }));

  $("forgot").addEventListener("click", (e) => {
    e.preventDefault();
    alertBox("Password resets are handled by your centre or an administrator for now. Contact them and they'll set a new one.", true);
  });
  $("help").addEventListener("click", (e) => { e.preventDefault(); alertBox("Need a hand? Contact your centre and we'll help you sign in.", true); });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox(""); fieldErr("email", ""); fieldErr("password", "");
    const email = $("email").value.trim(), password = $("password").value;
    let bad = false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fieldErr("email", "Enter a valid email address"); bad = true; }
    if (!password) { fieldErr("password", "Enter your password"); bad = true; }
    if (bad) return;

    $("go").disabled = true; $("go").firstChild.textContent = "Signing in… ";
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: $("remember").checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sign in");
      location.replace(data.redirect);
    } catch (err) {
      alertBox(err.message);
      $("password").value = "";
      $("go").disabled = false; $("go").firstChild.textContent = "Sign in ";
    }
  });
})();

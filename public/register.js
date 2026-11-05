(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FIELDS = ["fullName", "email", "password", "confirmPassword", "centreId", "memberId", "agree"];

  fetch("/api/auth/centres").then((r) => r.json()).then((list) => {
    list.forEach((c) => $("centreId").insertAdjacentHTML("beforeend", `<option value="${c.centreId}">${esc(c.name)}</option>`));
  }).catch(() => ($("alert").innerHTML = '<div class="alert">Could not load centres. Refresh the page.</div>'));

  const fieldErr = (id, m) => {
    const f = $("f-" + id); if (!f) return;
    f.classList.toggle("bad", !!m);
    f.querySelector(".msg").textContent = m || "";
  };
  const clearAll = () => { $("alert").innerHTML = ""; FIELDS.forEach((f) => fieldErr(f, "")); };

  document.querySelectorAll("[data-eye]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = $(b.dataset.eye);
      i.type = i.type === "password" ? "text" : "password";
    }));
  $("help").addEventListener("click", (e) => { e.preventDefault(); $("alert").innerHTML = '<div class="alert ok">Need a hand? Your centre can help you find your member ID.</div>'; });

  function validate() {
    const v = { fullName: $("fullName").value.trim(), email: $("email").value.trim(), password: $("password").value,
      confirmPassword: $("confirmPassword").value, centreId: $("centreId").value, memberId: $("memberId").value.trim(), agree: $("agree").checked };
    const errs = {};
    if (v.fullName.length < 2) errs.fullName = "Enter your full name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errs.email = "Enter a valid email address";
    if (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password)) errs.password = "Use at least 8 characters, including a letter and a number";
    if (v.confirmPassword !== v.password) errs.confirmPassword = "Passwords don't match";
    if (!v.centreId) errs.centreId = "Select your training centre";
    if (!v.agree) errs.agree = "You need to agree to continue";
    return { v, errs };
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAll();
    const { v, errs } = validate();
    const keys = Object.keys(errs);
    if (keys.length) { keys.forEach((k) => fieldErr(k, errs[k])); $(keys[0]).focus(); return; }

    $("go").disabled = true; $("go").firstChild.textContent = "Creating… ";
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || "Could not create your account");
        err.field = data.field;
        throw err;
      }
      location.replace(data.redirect);
    } catch (err) {
      if (err.field && $("f-" + err.field)) { fieldErr(err.field, err.message); $(err.field).focus(); }
      else $("alert").innerHTML = `<div class="alert">${esc(err.message)}</div>`;
      $("go").disabled = false; $("go").firstChild.textContent = "Create account ";
    }
  });
})();

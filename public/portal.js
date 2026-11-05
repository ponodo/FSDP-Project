(async function () {
  const $ = (id) => document.getElementById(id);
  $("logout").addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
    location.replace("login.html");
  });
  try {
    const p = await U.api("/api/portal");
    $("hello").textContent = `Welcome, ${p.name}.`;
    $("info").textContent = [p.centre, p.memberId ? "Member ID " + p.memberId : null].filter(Boolean).join(" · ");
    if (!p.linked) {
      $("linkNote").innerHTML = '<div class="alert ok">Your account isn\'t linked to a student record yet, so invoices won\'t show. Ask your centre to link it to your member ID.</div>';
    }
    $("classes").innerHTML = p.classes.length
      ? `<table><tbody>${p.classes.map((c) => `<tr><td><b>${new Date(c.classDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</b></td><td>${U.esc(c.startTime)} · ${c.durationMin} min</td><td>${U.esc(c.title)}</td><td>${U.esc([c.venue, c.instructor].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty">No classes in the next 14 days.</div>';
    const cls = { Paid: "", Unpaid: "bad", Reported: "warn" };
    $("invoices").innerHTML = p.invoices.length
      ? p.invoices.map((i) => `<tr><td>${U.esc(i.invoiceNo)}</td><td>${U.esc(i.feeType)}</td><td><b>${U.money(i.amount)}</b></td><td>${U.dayLong(i.dueDate)}</td><td><span class="pill ${cls[i.status] || ""}">${U.esc(i.status)}</span></td></tr>`).join("")
      : '<tr><td colspan="5" class="empty">No invoices yet.</td></tr>';
  } catch (e) {
    $("error").innerHTML = `<div class="alert err">${U.esc(e.message)}</div>`;
  }
})();

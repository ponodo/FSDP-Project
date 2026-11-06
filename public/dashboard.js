(async function () {
  const $ = (id) => document.getElementById(id);
  const meta = await bootShell();
  const SG = "Asia/Singapore";
  let reqId = 0;

  meta.centres.forEach((c) => $("centre").insertAdjacentHTML("beforeend", `<option value="${c.centreId}">${U.esc(c.name)}</option>`));

  // greeting uses Singapore time, whatever the computer's clock says
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: SG }).format(now)) % 24;
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  $("greeting").textContent = `Good ${part}, ${meta.user.name}.`;
  $("today").textContent =
    now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: SG }) +
    " · A clear view of your day across every centre.";
  $("clsDate").textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SG });

  const pad = (n) => String(n).padStart(2, "0");
  const GTYPE = { Mass: "Mass grading", Private: "Private grading" };

  function render(d) {
    const m = d.money;
    $("kCollected").textContent = U.money(m.collected);
    $("kCollectedN").textContent = m.percentInvoiced === null
      ? "No invoices issued this month"
      : `${m.percentInvoiced}% of ${U.money(m.invoiced)} invoiced`;
    $("kOut").textContent = U.money(m.outstanding);
    $("kOutN").textContent = `${U.num(m.invoiceCount)} ${m.invoiceCount === 1 ? "invoice" : "invoices"} · ${U.num(m.overdue)} overdue`;

    $("clsCount").textContent = `${d.classesTotal} ${d.classesTotal === 1 ? "class" : "classes"} today`;
    $("classes").innerHTML = d.classes.length
      ? d.classes.map((c) => `
        <div class="cls ${c.enrolled >= c.capacity ? "full" : ""}">
          <div class="t"><b>${U.esc(c.startTime)}</b><small>${c.durationMin} min</small></div>
          <div class="m"><b>${U.esc(c.title)}</b><small>${U.esc([c.centre, c.venue, c.instructor].filter(Boolean).join(" · "))}</small></div>
          <div class="cap">${c.enrolled} / ${c.capacity}</div><div class="chev">›</div>
        </div>`).join("") +
        (d.classesTotal > d.classes.length ? `<div class="fine">Showing ${d.classes.length} of ${d.classesTotal}.</div>` : "")
      : '<div class="empty">No classes scheduled today.</div>';

    const a = d.attention;
    const items = [
      [a.reportedPayments, "Reported payments →", "Match and verify bank transfers", "payments.html"],
      [a.gradingResults, "Grading results →", "Review before publishing", "#"],
      [a.conflicts, "Scheduling conflict →", "Resolve an instructor overlap", "#"],
    ];
    $("attention").innerHTML = items.map(([n, t, s, href]) => `
      <a class="item" href="${href}"><span class="n ${n ? "" : "zero"}">${pad(n)}</span><span><b>${t}</b><small>${s}</small></span></a>`).join("");

    const g = d.nextGrading;
    $("grading").innerHTML = g ? `
      <h2 style="font-size:15px;margin-bottom:12px">Coming up</h2>
      <span class="tag-red">${U.esc(GTYPE[g.type] || g.type + " grading")}</span>
      <h3>${U.esc(g.title)}</h3>
      <div class="muted">${new Date(g.sessionDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${U.esc(g.startTime)}–${U.esc(g.endTime)}<br>${U.esc(g.centre)} · ${U.esc(g.venue)}</div>
      <div class="kv"><span>Registered</span><b>${g.registered} / ${g.capacity} students</b></div>
      <div class="kv"><span>Lead examiner</span><b>${U.esc(g.leadExaminer)}</b></div>
      <a class="btn" href="#" style="margin-top:14px">Review session</a>`
      : '<h2 style="font-size:15px;margin-bottom:12px">Coming up</h2><div class="empty">No grading sessions scheduled.</div>';
  }

  async function load() {
    const my = ++reqId;
    $("error").innerHTML = "";
    $("content").classList.add("loading");
    try {
      const d = await U.api("/api/overview?" + U.qs({ centreId: $("centre").value }));
      if (my === reqId) render(d);
    } catch (e) {
      if (my === reqId) $("error").innerHTML = `<div class="alert err">${U.esc(e.message)}</div>`;
    } finally {
      if (my === reqId) $("content").classList.remove("loading");
    }
  }
  $("centre").addEventListener("change", load);
  load();
})();

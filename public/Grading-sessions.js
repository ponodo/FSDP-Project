// Screen 06 - Grading sessions
(async function () {
  const $ = (id) => document.getElementById(id);
  const API = "/api/grading";
  const state = { tab: "upcoming", termId: "", centreId: "", type: "", search: "", sessions: [], selectedId: null };
  let reqId = 0;

  const showError = (msg) =>
    ($("error").innerHTML = msg ? `<div class="alert err">${U.esc(msg)}</div>` : "");
  const dateObj = (ymd) => new Date(ymd + "T00:00:00");
  const typeTag = (t) => `<span class="tag ${t === "Mass" ? "red" : "navy"}">${U.esc(t)}</span>`;
  const statusTag = (s) =>
    `<span class="tag ${s === "Confirmed" ? "green" : s === "Cancelled" ? "red" : ""}">${U.esc(s)}</span>`;
  const examiners = (s) =>
    [s.leadExaminer, s.supportingExaminer].filter(Boolean).map(U.esc).join(" + ") || "Not assigned";
  const money = (n) => "$" + Number(n || 0).toFixed(2);

  /* ---------- list ---------- */
  async function loadList() {
    const my = ++reqId;
    $("sessList").classList.add("loading");
    try {
      const data = await U.api(
        `${API}/sessions?${U.qs({
          tab: state.tab,
          termId: state.termId,
          centreId: state.centreId,
          type: state.type,
          search: state.search,
        })}`,
      );
      if (my !== reqId) return; // a newer request finished first
      showError("");
      state.sessions = data.sessions;
      $("countUpcoming").textContent = data.counts.upcoming;
      $("countCompleted").textContent = data.counts.completed;
      $("listTitle").textContent = state.tab === "upcoming" ? "Upcoming sessions" : "Completed sessions";
      if (!state.sessions.some((s) => s.sessionId === state.selectedId))
        state.selectedId = state.sessions[0] ? state.sessions[0].sessionId : null;
      renderList();
      loadDetails();
    } catch (e) {
      showError(e.message);
      $("sessList").innerHTML = `<div class="empty">Couldn't load sessions.</div>`;
    } finally {
      $("sessList").classList.remove("loading");
    }
  }

  function renderList() {
    $("sessList").innerHTML = state.sessions.length
      ? state.sessions
          .map((s) => {
            const d = dateObj(s.sessionDate);
            const count =
              s.type === "Private"
                ? `${s.registered} student`
                : `${s.registered} / ${s.capacity}`;
            return `<div class="sess ${s.sessionId === state.selectedId ? "sel" : ""}" data-id="${s.sessionId}" tabindex="0" role="button">
              <div class="datebox"><b>${String(d.getDate()).padStart(2, "0")}</b>
                <small>${d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}</small></div>
              <div class="info"><b>${U.esc(s.title)}</b>
                <small>${U.esc(s.centreName)} · ${U.esc(s.venue)} · ${U.esc(s.startTime)}–${U.esc(s.endTime)}</small>
                <small>Examiners: ${examiners(s)}</small></div>
              <div class="right">${typeTag(s.type)}<span>${count}</span></div>
            </div>`;
          })
          .join("")
      : `<div class="empty">No ${state.tab} sessions match these filters.</div>`;
  }

  /* ---------- details panel ---------- */
  async function loadDetails() {
    const box = $("details");
    if (!state.selectedId) {
      box.innerHTML = `<div class="card-head" style="margin-bottom:0"><h2>Session details</h2></div>
        <p class="st-mut" style="font-size:13px">Select a session to see its details.</p>`;
      return;
    }
    const s = await U.api(`${API}/sessions/${state.selectedId}`).catch((e) => {
      showError(e.message);
      return null;
    });
    if (!s || s.sessionId !== state.selectedId) return;
    const d = dateObj(s.sessionDate);
    const editable = ["Draft", "Confirmed"].includes(s.status);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;

    box.innerHTML = `
      <div class="card-head" style="margin-bottom:6px"><h2>Session details</h2></div>
      ${statusTag(s.status)} ${typeTag(s.type)}
      <h3>${U.esc(s.title)}</h3>
      ${kv("Session", U.esc(s.code))}
      ${kv("Date", d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}
      ${kv("Time", `${U.esc(s.startTime)}–${U.esc(s.endTime)} SGT`)}
      ${kv("Venue", `${U.esc(s.centreName)} · ${U.esc(s.venue)}`)}
      ${s.type === "Private"
        ? kv("Student", s.students.map((x) => U.esc(x.name)).join(", ") || "-")
        : kv("Registered", `${s.registered} / ${s.capacity} students`)}
      ${kv("Registration closes", s.registrationCloses ? U.dayLong(s.registrationCloses + "T00:00:00") : "-")}
      ${kv("Fee per student", money(s.fee))}
      ${kv("Lead examiner", U.esc(s.leadExaminer || "-"))}
      ${kv("Supporting examiner", U.esc(s.supportingExaminer || "-"))}
      <div class="avail wait" id="availBox"><b>Checking availability…</b></div>
      ${editable
        ? `<a class="btn block" href="Grading-setup.html?id=${s.sessionId}">Edit session &amp; assignments</a>`
        : `<a class="btn block" href="Results.html?sessionId=${s.sessionId}">View results</a>`}`;

    if (!editable) {
      $("availBox").remove();
      return;
    }
    try {
      const a = await U.api(`${API}/sessions/check-availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centreId: s.centreId,
          venue: s.venue,
          sessionDate: s.sessionDate,
          startTime: s.startTime,
          endTime: s.endTime,
          leadExaminerId: s.leadExaminerId,
          supportingExaminerId: s.supportingExaminerId,
          excludeSessionId: s.sessionId,
        }),
      });
      const el = $("availBox");
      if (!el) return;
      el.className = `avail ${a.available ? "ok" : "bad"}`;
      el.innerHTML = a.available
        ? `<b>✓ Instructors &amp; space available</b>No conflicts for this session.`
        : `<b>⚠ ${a.conflicts.length} conflict${a.conflicts.length === 1 ? "" : "s"} found</b>
           <ul>${a.conflicts
             .map((c) => `<li>${U.esc(c.who)}: ${U.esc(c.title)} (${U.esc(c.startTime)}–${U.esc(c.endTime)})</li>`)
             .join("")}</ul>`;
    } catch (e) {
      const el = $("availBox");
      if (el) el.innerHTML = `<b>Couldn't check availability</b>${U.esc(e.message)}`;
    }
  }

  /* ---------- "results are ready" banner ---------- */
  async function loadReadyBanner() {
    try {
      const p = await U.api(`${API}/results/pending-summary`);
      if (!p.total) return ($("readyBanner").innerHTML = "");
      const s = p.sessions[0];
      $("readyBanner").innerHTML = `<div class="alert ok ready-banner">
        <span><b>Results are ready</b><br>${p.total} result${p.total === 1 ? "" : "s"} from the
        ${U.esc(U.day(s.sessionDate + "T00:00:00"))} ${U.esc(s.centreName)} session need review before belt levels are updated.</span>
        <a class="btn" href="Results.html?sessionId=${s.sessionId}">Review grading results →</a></div>`;
    } catch (e) {
      /* banner is optional */
    }
  }

  /* ---------- events ---------- */
  ["term", "centre", "type"].forEach((id) =>
    $(id).addEventListener("change", (e) => {
      state[id === "term" ? "termId" : id === "centre" ? "centreId" : "type"] = e.target.value;
      loadList();
    }),
  );
  $("search").addEventListener(
    "input",
    U.debounce((e) => {
      state.search = e.target.value.trim();
      loadList();
    }),
  );
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
      state.tab = t.dataset.tab;
      state.selectedId = null;
      loadList();
    }),
  );
  const pick = (el) => {
    if (!el) return;
    state.selectedId = Number(el.dataset.id);
    renderList();
    loadDetails();
    if (window.innerWidth < 960) $("details").scrollIntoView({ behavior: "smooth" });
  };
  $("sessList").addEventListener("click", (e) => pick(e.target.closest(".sess")));
  $("sessList").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(e.target.closest(".sess"));
    }
  });

  /* ---------- start ---------- */
  await bootShell();
  try {
    const opts = await U.api(`${API}/options`);
    opts.terms.forEach((t) => $("term").insertAdjacentHTML("beforeend", `<option value="${t.id}">${U.esc(t.name)}</option>`));
    opts.centres.forEach((c) => $("centre").insertAdjacentHTML("beforeend", `<option value="${c.id}">${U.esc(c.name)}</option>`));
  } catch (e) {
    showError(e.message);
  }
  const saved = new URLSearchParams(location.search).get("saved");
  if (saved) {
    state.selectedId = Number(saved);
    $("savedMsg").innerHTML = `<div class="alert ok"><b>Session saved</b> · venue, capacity and examiner assignments confirmed.</div>`;
    history.replaceState(null, "", location.pathname);
  }
  loadList();
  loadReadyBanner();
})();
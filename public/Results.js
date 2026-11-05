// Screen 08 - Results & belt promotions
(async function () {
  const $ = (id) => document.getElementById(id);
  const API = "/api/grading";
  const state = {
    sessions: [],
    sessionId: null,
    tab: "review", // review | published
    filter: "",
    results: [],
    selected: new Set(),
    previewId: null,
    belts: [],
  };

  /* ---------- helpers ---------- */
  const showError = (msg) =>
    ($("error").innerHTML = msg ? `<div class="alert err">${U.esc(msg)}</div>` : "");
  const beltById = (id) => state.belts.find((b) => b.id === id);
  const isPromotion = (r) =>
    r.result === "Pass" && r.newBeltId && r.newBeltId !== r.currentBeltId;
  const resultLabel = (r) =>
    r.result === "Reassess" ? "Re-assess" : r.result || "Not entered";

  // "2026-11-05 09:10" -> "09:10" (today) or "5 Nov, 09:10"
  function when(s) {
    if (!s) return "";
    const [d, t] = s.split(" ");
    if (d === U.ymd(new Date())) return t;
    return `${U.day(d + "T00:00:00")}, ${t}`;
  }

  function emailText(r) {
    if (state.tab === "review") {
      if (!r.result) return `<span class="st-mut">Needs a result</span>`;
      if (!isPromotion(r)) return `<span class="st-mut">No promotion email</span>`;
      return $("sendEmails").checked
        ? `<span class="st-ok" style="color:var(--red)">Ready to queue</span>`
        : `<span class="st-mut">Emails switched off</span>`;
    }
    return notifText(r.emailStatus, r.emailSentAt, r.emailRetryInMin, r.emailError);
  }

  function notifText(status, sentAt, retryIn, error) {
    if (status === "Delivered") return `<span class="st-ok">Delivered · ${U.esc(when(sentAt))}</span>`;
    if (status === "Queued")
      return `<span class="st-wait">Queued · ${
        retryIn > 0 ? `retry in ${retryIn} min` : "sending"
      }</span>`;
    if (status === "Failed")
      return `<span class="st-bad">Failed · ${U.esc((error || "error").toLowerCase())}</span>`;
    return `<span class="st-mut">No promotion email</span>`;
  }

  /* ---------- loading ---------- */
  async function loadSessions() {
    state.sessions = await U.api(`${API}/results/sessions`);
    const sel = $("session");
    if (!state.sessions.length) {
      sel.innerHTML = `<option value="">No graded sessions yet</option>`;
      return;
    }
    sel.innerHTML = state.sessions
      .map(
        (s) =>
          `<option value="${s.sessionId}">${U.esc(U.day(s.sessionDate + "T00:00:00"))} · ${U.esc(
            s.title,
          )}</option>`,
      )
      .join("");
    if (!state.sessionId) {
      const fromUrl = Number(new URLSearchParams(location.search).get("sessionId"));
      const pick =
        state.sessions.find((s) => s.sessionId === fromUrl) ||
        state.sessions.find((s) => s.needsReview > 0) ||
        state.sessions[0];
      state.sessionId = pick.sessionId;
    }
    sel.value = state.sessionId;
    updateCounts();
  }

  function currentSession() {
    return state.sessions.find((s) => s.sessionId === state.sessionId);
  }

  function updateCounts() {
    const s = currentSession();
    $("countReview").textContent = s ? s.needsReview : 0;
    $("countPublished").textContent = s ? s.published : 0;
    $("sessionCode").textContent = s ? s.code : "";
    $("sessionCode").classList.toggle("hidden", !s);
  }

  async function loadHeadPills(meta) {
    let pending = 0;
    try {
      pending = (await U.api(`${API}/results/pending-summary`)).total;
    } catch (e) {
      /* pills are optional */
    }
    const t = meta && meta.term;
    $("headPills").innerHTML =
      (t ? `<span class="tag">${U.esc(t.name)}</span><span class="tag green">${U.esc(t.status || "In progress")}</span>` : "") +
      `<span class="tag red">${pending} result${pending === 1 ? "" : "s"} ready</span>`;
  }

  async function loadResults() {
    if (!state.sessionId) return renderResults();
    const data = await U.api(
      `${API}/results?${U.qs({ sessionId: state.sessionId, tab: state.tab })}`,
    );
    state.results = data.results;
    // review tab: select everything that has a result entered
    state.selected = new Set(
      state.tab === "review" ? state.results.filter((r) => r.result).map((r) => r.resultId) : [],
    );
    if (!state.results.some((r) => r.resultId === state.previewId)) {
      const first = state.results.find(isPromotion);
      state.previewId = first ? first.resultId : null;
    }
    renderResults();
    loadPreview();
  }

  async function loadNotifications() {
    try {
      const rows = await U.api(
        `${API}/notifications?${U.qs({ sessionId: state.sessionId, limit: 20 })}`,
      );
      renderNotifications(rows);
      $("notifStamp").textContent = `Updated ${new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch (e) {
      $("notifRows").innerHTML = `<tr><td colspan="4" class="empty">${U.esc(e.message)}</td></tr>`;
    }
  }

  async function loadPreview() {
    const box = $("emailPreview");
    if (!state.previewId) {
      box.innerHTML = "Select a passing result to preview its email.";
      return;
    }
    try {
      const p = await U.api(`${API}/results/${state.previewId}/email-preview`);
      box.innerHTML = p.willSend
        ? `<div class="to">TO · ${U.esc(p.to)}</div>
           <div class="subj">${U.esc(p.subject)}</div>
           <div class="body">${U.esc(p.body)}</div>`
        : `<span class="st-mut">${U.esc(p.reason)}</span>`;
    } catch (e) {
      box.innerHTML = `<span class="st-bad">${U.esc(e.message)}</span>`;
    }
  }

  /* ---------- rendering ---------- */
  function renderResults() {
    const review = state.tab === "review";
    const rows = state.results.filter((r) => !state.filter || r.result === state.filter);
    $("selectAll").disabled = !review;

    $("resultRows").innerHTML = rows.length
      ? rows
          .map((r) => {
            const moved = r.newBelt && r.newBeltId !== r.currentBeltId;
            return `<tr class="res-row ${r.resultId === state.previewId ? "sel" : ""}" data-id="${r.resultId}">
              <td>${
                review
                  ? `<input type="checkbox" class="pick" data-id="${r.resultId}" ${
                      state.selected.has(r.resultId) ? "checked" : ""
                    } ${r.result ? "" : "disabled"} aria-label="Select ${U.esc(r.studentName)}" />`
                  : ""
              }</td>
              <td class="stu"><b>${U.esc(r.studentName)}</b><small>${U.esc(r.memberCode)}</small></td>
              <td><span class="belt-move">${U.esc(r.currentBelt)}<span class="arrow">→</span>
                <span class="${moved ? "up" : ""}">${U.esc(r.newBelt || r.targetBelt)}</span></span></td>
              <td><span class="r-${r.result || "none"}">${U.esc(resultLabel(r))}</span>${
                review ? ` · <button class="link-btn edit" data-id="${r.resultId}">Edit</button>` : ""
              }</td>
              <td>${emailText(r)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="empty">${
          review ? "Nothing waiting for review in this session." : "No published results yet."
        }</td></tr>`;

    const reviewed = state.results.find((r) => r.reviewedBy);
    $("tableFoot").textContent =
      (reviewed
        ? `Reviewed by ${reviewed.reviewedBy} · ${U.dayLong((reviewed.reviewedAt || "").split(" ")[0] + "T00:00:00")} · `
        : "") + "Only passing results change a student's belt level.";

    const pickable = state.results.filter((r) => r.result);
    $("selectAll").checked =
      review && pickable.length > 0 && pickable.every((r) => state.selected.has(r.resultId));
    renderSummary();
  }

  function renderSummary() {
    const review = state.tab === "review";
    const sel = state.results.filter((r) => state.selected.has(r.resultId));
    const promos = sel.filter(isPromotion).length;
    const emails = $("sendEmails").checked ? promos : 0;
    const count = (res) => sel.filter((r) => r.result === res).length;

    $("selTag").textContent = `${sel.length} selected result${sel.length === 1 ? "" : "s"}`;
    $("sumHeadline").textContent = !review
      ? "Switch to Needs review to publish."
      : !sel.length
        ? "Select results to publish."
        : promos
          ? `${promos} promotion${promos === 1 ? "" : "s"}. One shared milestone.`
          : "No promotions in this selection.";
    $("sumPass").textContent = `${count("Pass")} student${count("Pass") === 1 ? "" : "s"}`;
    $("sumReassess").textContent = `${count("Reassess")} student${count("Reassess") === 1 ? "" : "s"}`;
    $("sumFail").textContent = `${count("Fail")} student${count("Fail") === 1 ? "" : "s"}`;
    $("sumBelts").textContent = promos;
    $("sumEmails").textContent = emails;

    const btn = $("publishBtn");
    btn.disabled = !review || !sel.length;
    btn.textContent = sel.length
      ? `Publish ${sel.length} reviewed result${sel.length === 1 ? "" : "s"}`
      : "Publish reviewed results";
  }

  function renderNotifications(rows) {
    $("notifRows").innerHTML = rows.length
      ? rows
          .map(
            (n) => `<tr>
              <td><b>${U.esc(n.studentName)}</b></td>
              <td>${U.esc(n.updatedBelt || "")}</td>
              <td>${notifText(n.status, n.sentAt, n.retryInMin, n.lastError)}</td>
              <td>${
                n.status === "Failed"
                  ? `<button class="link-btn resend" data-id="${n.notificationId}" data-name="${U.esc(
                      n.studentName,
                    )}" data-email="${U.esc(n.toEmail)}">Update &amp; resend</button>`
                  : `<button class="link-btn view" data-result="${n.resultId}">View</button>`
              }</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty">No promotion emails for this session yet.</td></tr>`;
  }

  /* ---------- edit result dialog ---------- */
  let editing = null;

  function openEdit(id) {
    editing = state.results.find((r) => r.resultId === id);
    if (!editing) return;
    const cur = beltById(editing.currentBeltId);
    $("editWho").textContent = `${editing.studentName} · ${editing.memberCode}`;
    $("editCurrent").textContent = editing.currentBelt;
    $("editResult").value = editing.result || "Pass";
    $("editLevel").innerHTML = state.belts
      .filter((b) => !cur || b.rankOrder > cur.rankOrder)
      .map((b) => `<option value="${b.id}">${U.esc(b.name)}</option>`)
      .join("");
    $("editLevel").value = isPromotion(editing) ? editing.newBeltId : editing.targetBeltId;
    $("editFeedback").value = editing.feedback || "";
    $("editError").innerHTML = "";
    syncEdit();
    $("editDlg").showModal();
  }

  function syncEdit() {
    const pass = $("editResult").value === "Pass";
    $("newLevelRow").classList.toggle("hidden", !pass);
    const lvl = $("editLevel");
    $("editNew").textContent = pass
      ? lvl.options[lvl.selectedIndex]
        ? lvl.options[lvl.selectedIndex].text
        : "-"
      : `${editing.currentBelt} (no change)`;
  }

  $("editResult").addEventListener("change", syncEdit);
  $("editLevel").addEventListener("change", syncEdit);
  $("editCancel").addEventListener("click", () => $("editDlg").close());
  $("editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { result: $("editResult").value, feedback: $("editFeedback").value };
    if (body.result === "Pass") body.newBeltId = Number($("editLevel").value);
    $("editSave").disabled = true;
    try {
      await U.api(`${API}/results/${editing.resultId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      $("editDlg").close();
      state.previewId = editing.resultId;
      await loadResults();
    } catch (err) {
      $("editError").innerHTML = `<div class="alert err">${U.esc(err.message)}</div>`;
    } finally {
      $("editSave").disabled = false;
    }
  });

  /* ---------- resend dialog ---------- */
  let resendId = null;
  $("resendCancel").addEventListener("click", () => $("resendDlg").close());
  $("resendForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await U.api(`${API}/notifications/${resendId}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: $("resendEmail").value.trim() }),
      });
      $("resendDlg").close();
      loadNotifications();
    } catch (err) {
      $("resendError").innerHTML = `<div class="alert err">${U.esc(err.message)}</div>`;
    }
  });

  /* ---------- events ---------- */
  $("session").addEventListener("change", async (e) => {
    state.sessionId = Number(e.target.value);
    state.previewId = null;
    $("banner").innerHTML = "";
    updateCounts();
    history.replaceState(null, "", `?sessionId=${state.sessionId}`);
    await Promise.all([loadResults(), loadNotifications()]).catch((err) => showError(err.message));
  });

  $("resultFilter").addEventListener("change", (e) => {
    state.filter = e.target.value;
    renderResults();
  });

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", async () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
      state.tab = t.dataset.tab;
      await loadResults().catch((err) => showError(err.message));
    }),
  );

  $("resultRows").addEventListener("click", (e) => {
    if (e.target.classList.contains("pick")) {
      const id = Number(e.target.dataset.id);
      e.target.checked ? state.selected.add(id) : state.selected.delete(id);
      return renderResults();
    }
    if (e.target.classList.contains("edit")) return openEdit(Number(e.target.dataset.id));
    const row = e.target.closest(".res-row");
    if (row) {
      state.previewId = Number(row.dataset.id);
      renderResults();
      loadPreview();
    }
  });

  $("selectAll").addEventListener("change", (e) => {
    state.selected = new Set(
      e.target.checked ? state.results.filter((r) => r.result).map((r) => r.resultId) : [],
    );
    renderResults();
  });

  $("sendEmails").addEventListener("change", renderResults);

  $("notifRows").addEventListener("click", (e) => {
    const b = e.target;
    if (b.classList.contains("view")) {
      state.previewId = Number(b.dataset.result);
      loadPreview();
      $("emailPreview").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (b.classList.contains("resend")) {
      resendId = Number(b.dataset.id);
      $("resendWho").textContent = `${b.dataset.name} · last tried ${b.dataset.email}`;
      $("resendEmail").value = b.dataset.email;
      $("resendError").innerHTML = "";
      $("resendDlg").showModal();
    }
  });

  $("importBtn").addEventListener("click", () =>
    alert("CSV import is coming soon. Results can be entered with Edit for now."),
  );

  $("publishBtn").addEventListener("click", async () => {
    const ids = [...state.selected];
    const promos = state.results.filter((r) => state.selected.has(r.resultId) && isPromotion(r)).length;
    if (!confirm(`Publish ${ids.length} result(s)? ${promos} student belt level(s) will be updated. This can't be undone.`))
      return;
    const btn = $("publishBtn");
    btn.disabled = true;
    btn.textContent = "Publishing…";
    showError("");
    try {
      const r = await U.api(`${API}/results/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultIds: ids, sendEmails: $("sendEmails").checked }),
      });
      await loadSessions();
      const left = currentSession() ? currentSession().needsReview : 0;
      $("banner").innerHTML = `<div class="alert ok"><b>${r.promotions} promotion${
        r.promotions === 1 ? "" : "s"
      } published · belt records updated</b><br>${r.emailsQueued} congratulatory email${
        r.emailsQueued === 1 ? "" : "s"
      } queued${r.reassessments ? ` · ${r.reassessments} re-assessment${r.reassessments === 1 ? "" : "s"} recorded` : ""}. ${
        left ? `${left} result${left === 1 ? "" : "s"} remain in review.` : "All results for this session are published."
      }</div>`;
      await Promise.all([loadResults(), loadNotifications(), loadHeadPills(meta)]);
    } catch (err) {
      showError(err.message);
      renderSummary();
    }
  });

  /* ---------- start ---------- */
  const meta = await bootShell();
  try {
    const opts = await U.api(`${API}/options`);
    state.belts = opts.belts;
    await loadSessions();
    await Promise.all([loadResults(), loadNotifications(), loadHeadPills(meta)]);
  } catch (err) {
    showError(err.message);
    $("resultRows").innerHTML = `<tr><td colspan="5" class="empty">Couldn't load results.</td></tr>`;
    $("notifRows").innerHTML = `<tr><td colspan="4" class="empty">-</td></tr>`;
  }

  // refresh email statuses while the page is open (the worker runs every 30s)
  setInterval(() => {
    if (document.visibilityState === "visible" && state.sessionId) {
      loadNotifications();
      if (state.tab === "published") loadResults().catch(() => {});
    }
  }, 15000);
})();
// Screen 07 - Schedule / edit grading session
(async function () {
  const $ = (id) => document.getElementById(id);
  const API = "/api/grading";
  const editId = Number(new URLSearchParams(location.search).get("id")) || null;
  let opts = { centres: [], instructors: [], spaces: [], students: [] };
  let type = "Mass";
  let existing = null;
  let conflicts = [];
  let checkId = 0;

  const showError = (msg) =>
    ($("error").innerHTML = msg ? `<div class="alert err">${U.esc(msg)}</div>` : "");
  const formError = (msg) =>
    ($("formError").innerHTML = msg ? `<div class="alert err">${U.esc(msg)}</div>` : "");
  const addDays = (ymd, n) => {
    const d = new Date(ymd + "T00:00:00");
    d.setDate(d.getDate() + n);
    return U.ymd(d);
  };
  const nameOf = (list, id) => (list.find((x) => String(x.id) === String(id)) || {}).name || "";

  /* ---------- form helpers ---------- */
  function setType(t) {
    type = t;
    document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.type === t));
    $("studentRow").classList.toggle("hidden", t !== "Private" || !!existing);
    $("capacity").disabled = t === "Private";
    if (t === "Private") $("capacity").value = 1;
    else if (Number($("capacity").value) <= 1) $("capacity").value = 40;
    renderReview();
    checkAvailability();
  }

  function fillVenues() {
    const centreId = Number($("centreId").value);
    const names = [...new Set(opts.spaces.filter((s) => s.centreId === centreId).map((s) => s.venue))];
    $("venueList").innerHTML = names.map((v) => `<option value="${U.esc(v)}"></option>`).join("");
  }

  function readForm() {
    const v = (id) => $(id).value.trim();
    const num = (id) => (v(id) === "" ? null : Number(v(id)));
    const body = {
      type,
      title: v("title"),
      centreId: num("centreId"),
      venue: v("venue"),
      sessionDate: v("sessionDate"),
      startTime: v("startTime"),
      endTime: v("endTime"),
      capacity: type === "Private" ? 1 : num("capacity"),
      fee: num("fee") || 0,
      registrationCloses: v("registrationCloses") || null,
      leadExaminerId: num("leadExaminerId"),
      supportingExaminerId: num("supportingExaminerId"),
    };
    if (type === "Private" && !existing) body.studentId = num("studentId");
    return body;
  }

  // Simple checks before we call the server (the server checks again)
  function validate(b) {
    if (type === "Private" && !existing && !b.studentId) return "Select the student for this private grading.";
    if (!b.title) return "Enter a session name.";
    if (!b.centreId || !b.venue) return "Choose a centre and training space.";
    if (!b.sessionDate || !b.startTime || !b.endTime) return "Enter the date, start time and end time.";
    if (b.endTime <= b.startTime) return "End time must be after start time.";
    if (!b.capacity || b.capacity < 1) return "Capacity must be at least 1.";
    if (b.registrationCloses && b.registrationCloses > b.sessionDate)
      return "Registration must close on or before the session date.";
    if (!b.leadExaminerId) return "Choose a lead examiner.";
    if (b.supportingExaminerId && b.supportingExaminerId === b.leadExaminerId)
      return "Supporting examiner must be different from the lead examiner.";
    if (conflicts.length) return "Resolve the availability conflict before saving.";
    return null;
  }

  function renderReview() {
    const b = readForm();
    $("rvTag").textContent = `${type} · ${existing ? existing.status : "New"}`;
    $("rvTitle").textContent = b.title || "Untitled session";
    $("rvWhen").textContent = b.sessionDate
      ? `${U.dayLong(b.sessionDate + "T00:00:00")}${b.startTime ? `, ${b.startTime}–${b.endTime || "?"}` : ""}`
      : "-";
    $("rvWhere").textContent = b.venue ? `${nameOf(opts.centres, b.centreId)} · ${b.venue}` : "-";
    $("rvCapLabel").textContent = type === "Private" ? "Student" : "Capacity";
    $("rvCap").textContent =
      type === "Private"
        ? existing
          ? (existing.students[0] || {}).name || "-"
          : nameOf(opts.students, b.studentId) || "-"
        : b.capacity
          ? `${existing ? existing.registered + " / " : ""}${b.capacity} students`
          : "-";
    $("rvExam").textContent =
      [nameOf(opts.instructors, b.leadExaminerId), nameOf(opts.instructors, b.supportingExaminerId)]
        .filter(Boolean)
        .join(" + ") || "-";
    $("rvFee").textContent = `$${Number(b.fee || 0).toFixed(2)} per student`;
  }

  /* ---------- live availability check ---------- */
  const checkAvailability = U.debounce(async () => {
    const b = readForm();
    const box = $("availBox");
    if (!b.centreId || !b.venue || !b.sessionDate || !b.startTime || !b.endTime || !b.leadExaminerId) {
      conflicts = [];
      box.className = "avail wait";
      box.innerHTML = "<b>Availability</b>Fill in the date, time, space and examiner to check for conflicts.";
      return;
    }
    if (b.endTime <= b.startTime) {
      box.className = "avail bad";
      box.innerHTML = "<b>⚠ Check the time</b>End time must be after start time.";
      return;
    }
    const my = ++checkId;
    box.className = "avail wait";
    box.innerHTML = "<b>Checking availability…</b>";
    try {
      const a = await U.api(`${API}/sessions/check-availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          centreId: b.centreId,
          venue: b.venue,
          sessionDate: b.sessionDate,
          startTime: b.startTime,
          endTime: b.endTime,
          leadExaminerId: b.leadExaminerId,
          supportingExaminerId: b.supportingExaminerId,
          excludeSessionId: editId,
        }),
      });
      if (my !== checkId) return; // an older check finished late
      conflicts = a.conflicts;
      box.className = `avail ${a.available ? "ok" : "bad"}`;
      box.innerHTML = a.available
        ? `<b>✓ Instructors &amp; space available</b>${U.esc(U.day(b.sessionDate + "T00:00:00"))} · ${U.esc(
            b.startTime,
          )}–${U.esc(b.endTime)} SGT. No conflicts for this session.`
        : `<b>⚠ ${conflicts.length === 1 ? "Conflict" : conflicts.length + " conflicts"} for this time</b>
           <ul>${conflicts
             .map(
               (c) =>
                 `<li>${U.esc(c.who)} ${c.kind === "space" ? "is booked" : "is busy"}: ${U.esc(c.title)} (${U.esc(
                   c.startTime,
                 )}–${U.esc(c.endTime)})</li>`,
             )
             .join("")}</ul>Choose another space, examiner or time. Saving is paused until this is resolved.`;
      $("saveBtn").disabled =
        !a.available || (existing && !["Draft", "Confirmed"].includes(existing.status));
    } catch (e) {
      if (my !== checkId) return;
      box.className = "avail wait";
      box.innerHTML = `<b>Couldn't check availability</b>${U.esc(e.message)}`;
    }
  }, 400);

  /* ---------- events ---------- */
  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      if (!existing) setType(b.dataset.type);
    }),
  );
  $("centreId").addEventListener("change", fillVenues);
  $("sessionDate").addEventListener("change", () => {
    // keep "registration closes" before the session for new sessions
    if (!existing && $("sessionDate").value) $("registrationCloses").value = addDays($("sessionDate").value, -4);
  });
  $("studentId").addEventListener("change", () => {
    const st = opts.students.find((s) => String(s.id) === $("studentId").value);
    if (st && !$("title").value.trim()) $("title").value = `Private grading - ${st.name}`;
    if (st) $("centreId").value = st.centreId;
    fillVenues();
  });
  $("form").addEventListener("input", () => {
    formError("");
    renderReview();
    checkAvailability();
  });
  $("form").addEventListener("change", () => {
    renderReview();
    checkAvailability();
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = readForm();
    const msg = validate(body);
    if (msg) return formError(msg);
    const btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const saved = await U.api(editId ? `${API}/sessions/${editId}` : `${API}/sessions`, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      location.href = `Grading-sessions.html?saved=${saved.sessionId}`;
    } catch (err) {
      formError(err.message);
      btn.disabled = false;
      btn.textContent = editId ? "Review & save changes" : "Review & save session";
    }
  });

  /* ---------- start ---------- */
  await bootShell();
  try {
    opts = await U.api(`${API}/options`);
    $("centreId").innerHTML = opts.centres.map((c) => `<option value="${c.id}">${U.esc(c.name)}</option>`).join("");
    const inst = opts.instructors.map((i) => `<option value="${i.id}">${U.esc(i.name)}</option>`).join("");
    $("leadExaminerId").innerHTML = `<option value="">Select…</option>${inst}`;
    $("supportingExaminerId").innerHTML = `<option value="">None</option>${inst}`;
    $("studentId").innerHTML =
      `<option value="">Select a student…</option>` +
      opts.students
        .map((s) => `<option value="${s.id}">${U.esc(s.name)} · ${U.esc(s.memberCode)} · ${U.esc(s.currentBelt)}</option>`)
        .join("");

    if (editId) {
      existing = await U.api(`${API}/sessions/${editId}`);
      if (!["Draft", "Confirmed"].includes(existing.status)) {
        showError("Completed or cancelled sessions can't be edited.");
        $("saveBtn").disabled = true;
      }
      $("pageTitle").textContent = "Edit grading session";
      $("pageSub").textContent = `${existing.code} · Review and update the session, examiners and space.`;
      document.title = `Edit ${existing.code} · Aikido Shinjukai`;
      $("codeHint").textContent = `${existing.code} · Editing the existing session`;
      $("codeHint").classList.remove("hidden");
      $("saveBtn").textContent = "Review & save changes";
      document.querySelectorAll(".seg button").forEach((b) => (b.disabled = b.dataset.type !== existing.type));
      [
        "title", "centreId", "venue", "sessionDate", "startTime", "endTime",
        "capacity", "fee", "registrationCloses", "leadExaminerId",
      ].forEach((k) => ($(k).value = existing[k] ?? ""));
      $("supportingExaminerId").value = existing.supportingExaminerId || "";
      fillVenues();
      setType(existing.type);
    } else {
      const date = addDays(U.ymd(new Date()), 14);
      $("sessionDate").value = date;
      $("sessionDate").min = U.ymd(new Date());
      $("registrationCloses").value = addDays(date, -4);
      $("startTime").value = "09:00";
      $("endTime").value = "12:00";
      $("capacity").value = 40;
      $("fee").value = "20.00";
      fillVenues();
      setType("Mass");
    }
  } catch (e) {
    showError(e.message);
    $("saveBtn").disabled = true;
  }
})();
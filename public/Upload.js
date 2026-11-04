(async function () {
  const $ = (id) => document.getElementById(id);
  let file = null,
    opts,
    uploading = false;

  await bootShell();
  try {
    opts = await U.api("/api/documents/options");
  } catch (e) {
    $("formError").innerHTML =
      `<div class="alert err">${U.esc(e.message)}</div>`;
    return;
  }

  // fill dropdowns
  $("category").innerHTML = opts.categories
    .map((c) => `<option>${U.esc(c)}</option>`)
    .join("");
  $("centre").innerHTML =
    '<option value="all">All centres</option>' +
    opts.centres
      .map((c) => `<option value="${c.centreId}">${U.esc(c.name)}</option>`)
      .join("");
  $("term").insertAdjacentHTML(
    "beforeend",
    opts.terms
      .map((t) => `<option value="${t.termId}">${U.esc(t.name)}</option>`)
      .join(""),
  );
  $("access").innerHTML = opts.access
    .map((a) => `<option>${U.esc(a)}</option>`)
    .join("");

  // pre-select from ?category=
  const pre = new URLSearchParams(location.search).get("category");
  if (pre && opts.categories.includes(pre)) $("category").value = pre;

  function fillSessions() {
    const c = $("centre").value;
    const list = opts.sessions.filter(
      (s) => c === "all" || !s.centreId || String(s.centreId) === c,
    );
    const keep = $("session").value;
    $("session").innerHTML =
      '<option value="">None</option>' +
      list
        .map(
          (s) =>
            `<option value="${s.sessionId}">${U.dayLong(s.sessionDate)} · ${U.esc(s.code)}</option>`,
        )
        .join("");
    if (list.some((s) => String(s.sessionId) === keep))
      $("session").value = keep;
  }
  fillSessions();

  const ext = () =>
    file ? "." + file.name.split(".").pop().toLowerCase() : ".pdf";

  // ---- linked record panel (shows when this will become a new version) ----
  async function checkMatch() {
    const title = $("title").value.trim();
    if (!title)
      return renderLinked(null, "Add a title to check for an existing record.");
    try {
      const r = await U.api(
        "/api/documents/match?" +
          U.qs({
            category: $("category").value,
            centreId: $("centre").value,
            title,
            ext: ext(),
          }),
      );
      renderLinked(r.existing);
    } catch (e) {
      renderLinked(null, e.message);
    }
  }
  function renderLinked(d, msg) {
    const box = $("linked");
    if (!d) {
      box.innerHTML = `<span class="tag">New record</span><h3>${U.esc($("title").value.trim() || "Untitled")}${U.esc(ext())}</h3>
        <div class="fine" style="margin:0">${U.esc(msg || "No existing record with this title, category and centre. This will be saved as version 1.")}</div>`;
      return;
    }
    const kv = (k, v) =>
      `<div class="kv" style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--mut)">${k}</span><b>${U.esc(v)}</b></div>`;
    box.innerHTML = `<span class="tag">Existing record · Version ${d.version}</span><h3>${U.esc(d.name)}</h3>
      ${kv("Centre", d.centreName)}${kv("Uploaded by", d.uploadedBy)}${kv("Last updated", U.day(d.updatedAt) + " · " + U.time(d.updatedAt))}
      ${d.sessionLabel ? kv("Session", d.sessionLabel) : ""}
      <div class="fine">The previous version is retained when you save a replacement.${d.linkedRef ? " Linked to " + U.esc(d.linkedRef) + "." : ""}</div>`;
  }
  const debouncedMatch = U.debounce(checkMatch, 350);

  // ---- file picking ----
  function setFile(f) {
    file = f;
    if (!f) {
      $("dropEmpty").classList.remove("hidden");
      $("dropFile").classList.add("hidden");
      $("choose").textContent = "Choose file";
      return;
    }
    $("dropEmpty").classList.add("hidden");
    $("dropFile").classList.remove("hidden");
    $("fileName").textContent = f.name;
    $("fileMeta").textContent =
      `${f.name.split(".").pop().toUpperCase()} · ${U.size(f.size)}`;
    $("bar").style.width = "0";
    $("progText").className = "";
    $("progText").textContent = "Ready to upload";
    $("choose").textContent = "Choose another file";
    if (!$("title").value.trim())
      $("title").value = f.name.replace(/\.[^.]+$/, "");
    checkMatch();
  }
  $("choose").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const err = fileProblem(f);
    if (err) {
      showError(err);
      e.target.value = "";
      return;
    }
    clearError();
    setFile(f);
  });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    }),
  );
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const err = fileProblem(f);
    if (err) return showError(err);
    clearError();
    setFile(f);
  });
  function fileProblem(f) {
    if (!/\.(pdf|xlsx|png|jpe?g)$/i.test(f.name))
      return "Only PDF, XLSX or image files are allowed.";
    if (f.size > 10 * 1024 * 1024) return "File is over 10 MB.";
    return null;
  }

  ["title", "category", "centre"].forEach((id) =>
    $(id).addEventListener(id === "title" ? "input" : "change", debouncedMatch),
  );
  $("centre").addEventListener("change", fillSessions);

  const showError = (m) =>
    ($("formError").innerHTML = `<div class="alert err">${U.esc(m)}</div>`);
  const clearError = () => ($("formError").innerHTML = "");

  // ---- upload (XHR so we get real progress) ----
  function send() {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("title", $("title").value.trim());
      fd.append("category", $("category").value);
      fd.append("centreId", $("centre").value);
      fd.append("termId", $("term").value);
      fd.append("sessionId", $("session").value);
      fd.append("access", $("access").value);
      fd.append("file", file); // file last so the text fields are parsed first
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        $("bar").style.width = pct + "%";
        $("progText").textContent = pct + "%";
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          /* ignore */
        }
        xhr.status >= 200 && xhr.status < 300
          ? resolve(data)
          : reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () =>
        reject(
          new Error("Network error. Check your connection and try again."),
        );
      xhr.send(fd);
    });
  }

  async function submit() {
    if (uploading) return;
    clearError();
    if (!file) return showError("Choose a file to upload.");
    if (!$("title").value.trim())
      return showError("Document title is required.");
    uploading = true;
    $("save").disabled = true;
    $("save").textContent = "Uploading…";
    try {
      const r = await send();
      $("bar").style.width = "100%";
      $("progText").className = "ok";
      $("progText").textContent = "100% · Saved";
      $("okBox").className = "status ok";
      $("okBox").innerHTML =
        `<b>Document uploaded</b>Saved to ${U.esc(r.category)}${r.version > 1 ? ` as version ${r.version}. Previous version retained.` : "."}`;
      $("viewSaved").href = "documents.html";
      $("viewSaved").classList.remove("hidden");
      $("failBox").className = "status idle";
      $("failBox").textContent = "No errors.";
      $("retry").classList.add("hidden");
      file = null;
      $("file").value = "";
      $("title").value = "";
      setFile(null);
      renderLinked(null);
    } catch (e) {
      // record details stay filled in; the user can just retry
      $("failBox").className = "status bad";
      $("failBox").innerHTML =
        `<b>Upload interrupted</b>${U.esc(e.message)} Your record details are kept.`;
      $("retry").classList.remove("hidden");
      $("progText").className = "";
      $("progText").textContent = "Failed";
      showError(e.message);
    } finally {
      uploading = false;
      $("save").disabled = false;
      $("save").textContent = "Upload & save record";
    }
  }
  $("save").addEventListener("click", submit);
  $("retry").addEventListener("click", submit);

  renderLinked(null);
})();

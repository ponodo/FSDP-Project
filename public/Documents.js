(async function () {
  const $ = (id) => document.getElementById(id);
  const CATS = [
    { name: "Class schedules", icon: "schedule" },
    { name: "Grading records", icon: "grading" },
    { name: "Payment records", icon: "payments" },
    { name: "Centre documents", icon: "building" },
  ];
  const state = {
    category: "",
    folderId: "",
    centreId: "",
    q: "",
    type: "",
    tab: "all",
    sort: "updated",
    page: 1,
    selected: null,
  };
  let reqId = 0,
    currentItems = [];

  const meta = await bootShell();
  meta.centres.forEach((c) =>
    $("centre").insertAdjacentHTML(
      "beforeend",
      `<option value="${c.centreId}">${U.esc(c.name)}</option>`,
    ),
  );
  CATS.forEach((c) =>
    $("fCategory").insertAdjacentHTML(
      "beforeend",
      `<option>${c.name}</option>`,
    ),
  );

  const notice = (msg, kind = "err") => {
    $("notice").innerHTML = msg
      ? `<div class="alert ${kind}">${U.esc(msg)}</div>`
      : "";
    if (msg && kind === "ok")
      setTimeout(() => ($("notice").innerHTML = ""), 3500);
  };

  async function loadSummary() {
    try {
      const rows = await U.api(
        "/api/documents/summary?" + U.qs({ centreId: state.centreId }),
      );
      $("cats").innerHTML = CATS.map((c, i) => {
        const n = (rows.find((r) => r.category === c.name) || {}).count || 0;
        return `<button class="cat c${i} ${state.category === c.name ? "on" : ""}" data-cat="${c.name}">
          ${icon(c.icon)}<b>${c.name}</b><span>${n} ${n === 1 ? "file" : "files"}</span></button>`;
      }).join("");
    } catch (e) {
      notice(e.message);
    }
  }

  let folders = [];
  async function loadFolders() {
    if (!state.category) {
      folders = [];
      $("folders").innerHTML = "";
      return;
    }
    try {
      folders = await U.api(
        "/api/documents/folders?" + U.qs({ category: state.category }),
      );
      $("folders").innerHTML =
        `<button class="chip ${state.folderId ? "" : "on"}" data-folder="">All folders</button>` +
        folders
          .map(
            (f) =>
              `<button class="chip ${String(f.folderId) === String(state.folderId) ? "on" : ""}" data-folder="${f.folderId}">${U.esc(f.name)} · ${f.fileCount}</button>`,
          )
          .join("");
    } catch (e) {
      notice(e.message);
    }
  }

  function renderHead() {
    $("panelTitle").textContent = state.category || "All documents";
    const parts = ["All documents"];
    if (state.category) parts.push(state.category);
    const f = folders.find(
      (x) => String(x.folderId) === String(state.folderId),
    );
    if (f) parts.push(f.name);
    $("crumbs").textContent = parts.join(" / ");
  }

  async function loadList() {
    const my = ++reqId;
    try {
      const r = await U.api(
        "/api/documents?" + U.qs({ ...state, selected: "", pageSize: 6 }),
      );
      if (my !== reqId) return;
      if (state.page > r.pages) {
        state.page = r.pages;
        return loadList();
      }
      currentItems = r.items;
      $("tabs").innerHTML = [
        ["all", "All files", r.counts.all],
        ["recent", "Recently updated", null],
        ["archived", "Archived", null],
      ]
        .map(
          ([k, label, n]) =>
            `<button class="tab ${state.tab === k ? "on" : ""}" data-tab="${k}">${label}${state.tab === k ? " · " + r.total : ""}</button>`,
        )
        .join("");
      $("rows").innerHTML = r.items.length
        ? r.items
            .map(
              (d) => `
        <tr class="file-row ${state.selected === d.documentId ? "sel" : ""}" data-id="${d.documentId}">
          <td>${U.esc(d.name)}</td><td>${U.esc(d.centreName)}</td>
          <td>${U.day(d.updatedAt)} · ${U.esc(d.uploadedBy)}</td><td class="sz">${U.size(d.sizeBytes)}</td>
        </tr>`,
            )
            .join("")
        : '<tr><td colspan="4" class="empty">No files match these filters.</td></tr>';

      const start = r.total ? (r.page - 1) * r.pageSize + 1 : 0;
      const end = Math.min(r.total, r.page * r.pageSize);
      const nums = Array.from({ length: r.pages }, (_, i) => i + 1)
        .slice(0, 8)
        .map(
          (n) =>
            `<button class="${n === r.page ? "cur" : ""}" data-page="${n}">${n}</button>`,
        )
        .join("");
      $("pager").innerHTML =
        `<span>Showing ${r.total ? `${start}–${end}` : 0} of ${r.total} files</span>
        <span><button data-page="${r.page - 1}" ${r.page <= 1 ? "disabled" : ""}>← Previous</button>${nums}
        <button data-page="${r.page + 1}" ${r.page >= r.pages ? "disabled" : ""}>Next →</button></span>`;
    } catch (e) {
      if (my === reqId) notice(e.message);
    }
  }

  async function refresh(all = true) {
    notice("");
    if (all) {
      await Promise.all([loadSummary(), loadFolders()]);
    }
    renderHead();
    await loadList();
  }

  async function showDetails(id) {
    state.selected = id;
    document
      .querySelectorAll(".file-row")
      .forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === id));
    try {
      const d = await U.api("/api/documents/" + id);
      const kv = (k, v) =>
        `<div class="kv"><dt>${k}</dt><dd>${U.esc(v)}</dd></div>`;
      $("details").innerHTML = `
        <h2>File details</h2>
        <h2 style="font-size:15px">${U.esc(d.name)}</h2>
        <dl>
          ${kv("Centre", d.centreName)}${kv("Category", d.category)}${kv("Session", d.sessionLabel || "–")}
          ${kv("Term", d.termName || "–")}${kv("Uploaded by", d.uploadedBy)}
          ${kv("Last updated", U.day(d.updatedAt) + " · " + U.time(d.updatedAt))}${kv("Access", d.access)}
        </dl>
        <div class="btns">
          <a class="btn ${d.hasFile ? "" : "disabled"}" href="/api/documents/${d.documentId}/open" target="_blank" rel="noopener">${icon("open")}Open document</a>
          <a class="btn ${d.hasFile ? "" : "disabled"}" href="/api/documents/${d.documentId}/download">${icon("download")}Download</a>
          <button class="btn" id="archiveBtn">${d.isArchived ? "Restore from archive" : "Archive"}</button>
        </div>`;
      $("detailFoot").innerHTML =
        `Version ${d.version}${d.previousVersions ? " · Previous version retained" : ""}` +
        (d.linkedRef ? `<br>Linked to ${U.esc(d.linkedRef)}` : "") +
        (d.hasFile ? "" : "<br>Sample record · no file attached");
      $("archiveBtn").onclick = async () => {
        try {
          await U.api(`/api/documents/${d.documentId}/archive`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: !d.isArchived }),
          });
          notice(
            d.isArchived
              ? "Restored from archive."
              : "Archived. Find it under the Archived tab.",
            "ok",
          );
          state.selected = null;
          $("details").innerHTML =
            '<h2>File details</h2><div class="empty">Select a file to see its details.</div>';
          $("detailFoot").innerHTML = "";
          refresh();
        } catch (e) {
          notice(e.message);
        }
      };
    } catch (e) {
      notice(e.message);
    }
  }

  // ---- events ----
  $("cats").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.category = state.category === b.dataset.cat ? "" : b.dataset.cat; // click again to clear
    state.folderId = "";
    state.page = 1;
    refresh();
  });
  $("folders").addEventListener("click", (e) => {
    const b = e.target.closest("[data-folder]");
    if (!b) return;
    state.folderId = b.dataset.folder;
    state.page = 1;
    loadFolders().then(() => {
      renderHead();
      loadList();
    });
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    state.page = 1;
    loadList();
  });
  $("pager").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    loadList();
  });
  $("rows").addEventListener("click", (e) => {
    const r = e.target.closest("[data-id]");
    if (r) showDetails(Number(r.dataset.id));
  });
  $("q").addEventListener(
    "input",
    U.debounce((e) => {
      state.q = e.target.value.trim();
      state.page = 1;
      loadList();
    }),
  );
  $("type").addEventListener("change", (e) => {
    state.type = e.target.value;
    state.page = 1;
    loadList();
  });
  $("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    loadList();
  });
  $("centre").addEventListener("change", (e) => {
    state.centreId = e.target.value;
    state.page = 1;
    refresh();
  });

  // new folder dialog
  const dlg = $("folderDialog");
  $("newFolder").addEventListener("click", () => {
    $("fCategory").value = state.category || CATS[0].name;
    $("fName").value = "";
    $("fErr").textContent = "";
    dlg.showModal();
    $("fName").focus();
  });
  $("fCancel").addEventListener("click", () => dlg.close());
  $("fSave").addEventListener("click", async () => {
    try {
      const f = await U.api("/api/documents/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: $("fCategory").value,
          name: $("fName").value,
        }),
      });
      dlg.close();
      state.category = f.category;
      state.folderId = String(f.folderId);
      state.page = 1;
      await refresh();
      notice(`Folder "${f.name}" created.`, "ok");
    } catch (e) {
      $("fErr").textContent = e.message;
    }
  });

  refresh();
})();

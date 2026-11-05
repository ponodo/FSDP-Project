(async function () {
  const $ = (id) => document.getElementById(id);
  const state = { preset: "30", from: "", to: "", centreId: "", feeType: "" };
  let meta,
    lastReport,
    reqId = 0;

  meta = await bootShell();
  meta.centres.forEach((c) =>
    $("centre").insertAdjacentHTML(
      "beforeend",
      `<option value="${c.centreId}">${U.esc(c.name)}</option>`,
    ),
  );
  meta.feeTypes.forEach((f) =>
    $("feeType").insertAdjacentHTML(
      "beforeend",
      `<option>${U.esc(f)}</option>`,
    ),
  );

  function computeRange() {
    const today = new Date();
    let from,
      to = new Date(today);
    if (state.preset === "month")
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (state.preset === "lastmonth") {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (state.preset === "term") {
      return state.termFrom
        ? { from: state.termFrom, to: U.ymd(today) }
        : { from: "", to: "" };
    } else if (state.preset === "custom")
      return { from: $("from").value, to: $("to").value };
    else {
      from = new Date(today);
      from.setDate(from.getDate() - 29);
    }
    return { from: U.ymd(from), to: U.ymd(to) };
  }

  function params() {
    let r = computeRange();
    if (!r) r = { from: "", to: "" };
    state.from = r.from;
    state.to = r.to;
    return {
      from: r.from,
      to: r.to,
      centreId: state.centreId,
      feeType: state.feeType,
    };
  }

  const niceMax = (v) => {
    if (v <= 0) return 1000;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * pow;
  };

  function renderChart(weeks) {
    const max = niceMax(
      Math.max(...weeks.map((w) => Math.max(w.collected, w.outstanding)), 0),
    );
    $("yAxis").innerHTML = [0, 1, 2, 3, 4]
      .map((i) => `<span>${U.num(Math.round((max / 4) * i))}</span>`)
      .join("");
    $("bars").innerHTML = weeks
      .map(
        (w) => `
      <div class="week" title="${U.esc(w.label)}">
        <div class="total">${w.collected ? U.money(w.collected) : ""}</div>
        <div class="pair">
          <div class="b c" style="height:${(w.collected / max) * 100}%"></div>
          <div class="b o" style="height:${(w.outstanding / max) * 100}%"></div>
        </div>
      </div>`,
      )
      .join("");
    $("xLabels").innerHTML = weeks
      .map((w) => `<span>${U.esc(w.label)}</span>`)
      .join("");
  }

  function renderMethods(methods) {
    const max = Math.max(...methods.map((m) => m.total), 1);
    const shades = ["#3f6e57", "#7ba08c", "#b4cbbd", "#d5e2da"];
    $("methods").innerHTML = methods.length
      ? methods
          .map(
            (m, i) => `
        <div class="row">
          <div class="top"><span>${U.esc(m.method)}</span><b>${U.money(m.total)}</b></div>
          <div class="track"><div class="fill" style="width:${Math.max(4, (m.total / max) * 100)}%;background:${shades[Math.min(i, 3)]}"></div></div>
        </div>`,
          )
          .join("")
      : '<div class="empty">No payments in this range.</div>';
  }

  function renderCentres(rows, t) {
    $("centreRows").innerHTML =
      rows
        .map(
          (c) => `
      <tr>
        <td><b>${U.esc(c.name)}</b></td><td>${U.money(c.collected)}</td><td>${U.money(c.outstanding)}</td>
        <td class="num"><a href="#" data-centre="${c.centreId}" data-name="${U.esc(c.name)}">${U.num(c.transactions)}</a></td>
      </tr>`,
        )
        .join("") +
      `
      <tr class="total"><td>Total</td><td>${U.money(t.collected)}</td><td>${U.money(t.outstanding)}</td>
        <td class="num"><a href="#" data-centre="" data-name="All centres">${U.num(t.transactions)}</a></td></tr>`;
  }

  function setLinks(p) {
    const q = U.qs(p);
    $("exportAll").href = `/api/finance/export?type=transactions&${q}`;
    $("exportCentres").href = `/api/finance/export?type=centres&${q}`;
  }

  async function load() {
    const my = ++reqId;
    const p = params();
    $("error").innerHTML = "";
    $("content").classList.add("loading");
    $("txCard").classList.add("hidden");
    try {
      const r = await U.api("/api/finance/report?" + U.qs(p));
      if (my !== reqId) return; // a newer request replaced this one
      lastReport = r;
      // keep the date inputs in sync with whatever the server actually used
      $("from").value = r.filters.from;
      $("to").value = r.filters.to;
      setLinks({
        from: r.filters.from,
        to: r.filters.to,
        centreId: state.centreId,
        feeType: state.feeType,
      });
      $("kCollected").textContent = U.money(r.totals.collected);
      $("kCollectedN").textContent =
        `${U.num(r.totals.paymentCount)} completed payments`;
      $("kOut").textContent = U.money(r.totals.outstanding);
      $("kOutN").textContent = `${U.num(r.totals.unpaidCount)} unpaid invoices`;
      $("rangeLabel").textContent =
        `${U.day(r.filters.from)} – ${U.dayLong(r.filters.to)}`;
      $("stamp").textContent =
        "Updated today at " +
        new Date(r.updatedAt).toLocaleTimeString("en-GB", {
          timeZone: "Asia/Singapore",
          hour: "2-digit",
          minute: "2-digit",
        }) +
        " SGT";
      renderChart(r.weeks);
      renderMethods(r.methods);
      renderCentres(r.centres, r.centreTotals);
    } catch (e) {
      if (my === reqId)
        $("error").innerHTML =
          `<div class="alert err">${U.esc(e.message)}</div>`;
    } finally {
      if (my === reqId) $("content").classList.remove("loading");
    }
  }

  async function showTransactions(centreId, name) {
    const card = $("txCard");
    card.classList.remove("hidden");
    $("txTitle").textContent = `Transactions · ${name}`;
    $("txRows").innerHTML =
      '<tr><td colspan="8" class="empty">Loading…</td></tr>';
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const f = lastReport.filters;
      const rows = await U.api(
        "/api/finance/transactions?" +
          U.qs({ from: f.from, to: f.to, centreId, feeType: state.feeType }),
      );
      $("txRows").innerHTML = rows.length
        ? rows
            .map(
              (t) => `
        <tr><td>${U.dayLong(t.paymentDate)}</td><td>${U.esc(t.invoiceNo)}</td><td>${U.esc(t.studentName || "–")}</td>
        <td>${U.esc(t.centre)}</td><td>${U.esc(t.feeType)}</td><td>${U.esc(t.method)}</td>
        <td>${U.esc(t.bankReference || "–")}</td><td style="text-align:right"><b>${U.money(t.amount)}</b></td></tr>`,
            )
            .join("")
        : '<tr><td colspan="8" class="empty">No transactions for this selection.</td></tr>';
    } catch (e) {
      $("txRows").innerHTML =
        `<tr><td colspan="8" class="empty">${U.esc(e.message)}</td></tr>`;
    }
  }

  // events
  $("preset").addEventListener("change", async (e) => {
    state.preset = e.target.value;
    $("customDates").classList.toggle("hidden", state.preset !== "custom");
    if (state.preset === "term") {
      // term start date comes from the options endpoint
      try {
        const o = await U.api("/api/documents/options");
        const t =
          o.terms.find((x) => x.termId === meta.term.termId) || o.terms[0];
        state.termFrom = t.startDate;
      } catch (err) {
        state.termFrom = "";
      }
    }
    load();
  });
  $("from").addEventListener(
    "change",
    () => state.preset === "custom" && load(),
  );
  $("to").addEventListener("change", () => state.preset === "custom" && load());
  $("centre").addEventListener("change", (e) => {
    state.centreId = e.target.value;
    load();
  });
  $("feeType").addEventListener("change", (e) => {
    state.feeType = e.target.value;
    load();
  });
  $("centreRows").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-centre]");
    if (!a) return;
    e.preventDefault();
    showTransactions(a.dataset.centre, a.dataset.name);
  });
  $("txClose").addEventListener("click", () =>
    $("txCard").classList.add("hidden"),
  );

  load();
})();

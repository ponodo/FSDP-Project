const model = require("../models/Financemodel");
const httpError = require("../utils/HttpError");

const FEE_TYPES = ["Tuition", "Grading", "Registration", "Other"];

const isDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s || "") && !isNaN(new Date(s + "T00:00:00"));
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const short = (s) =>
  new Date(s + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

function cleanFilters(q) {
  const today = new Date();
  const back = new Date(today);
  back.setDate(back.getDate() - 29);
  const from = isDate(q.from) ? q.from : ymd(back);
  const to = isDate(q.to) ? q.to : ymd(today);
  if (from > to)
    throw httpError(400, "Start date must be on or before the end date");
  const days = (new Date(to) - new Date(from)) / 86400000;
  if (days > 366) throw httpError(400, "Date range can be at most 1 year");
  const centreId = /^\d+$/.test(q.centreId || "")
    ? parseInt(q.centreId, 10)
    : null;
  const feeType = FEE_TYPES.includes(q.feeType) ? q.feeType : null;
  return { from, to, centreId, feeType };
}

async function getReport(q) {
  const f = cleanFilters(q);
  const [totals, weekly, methods, centres] = await Promise.all([
    model.getTotals(f),
    model.getWeekly(f),
    model.getByMethod(f),
    model.getByCentre(f),
  ]);

  const weeks = [];
  const end = new Date(f.to + "T00:00:00");
  for (
    let i = 0, d = new Date(f.from + "T00:00:00");
    d <= end;
    i++, d.setDate(d.getDate() + 7)
  ) {
    const wEnd = new Date(d);
    wEnd.setDate(wEnd.getDate() + 6);
    const last = wEnd > end ? end : wEnd;
    const c = weekly.collected.find((x) => x.wk === i);
    const o = weekly.outstanding.find((x) => x.wk === i);
    weeks.push({
      label: `${short(ymd(d))} – ${short(ymd(last))}`,
      collected: c ? Number(c.total) : 0,
      outstanding: o ? Number(o.total) : 0,
    });
  }

  const rows = centres.map((c) => ({
    ...c,
    collected: Number(c.collected),
    outstanding: Number(c.outstanding),
  }));
  const sum = (k) => rows.reduce((a, c) => a + c[k], 0);
  return {
    filters: f,
    updatedAt: new Date().toISOString(),
    totals: {
      collected: Number(totals.collected),
      paymentCount: totals.paymentCount,
      outstanding: Number(totals.outstanding),
      unpaidCount: totals.unpaidCount,
    },
    weeks,
    methods: methods.map((m) => ({ method: m.method, total: Number(m.total) })),
    centres: rows,
    centreTotals: {
      collected: sum("collected"),
      outstanding: sum("outstanding"),
      transactions: sum("transactions"),
    },
  };
}

const getTransactions = async (q) =>
  (await model.getTransactions(cleanFilters(q))).map((t) => ({
    ...t,
    amount: Number(t.amount),
  }));

const cell = (v) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s; // stop spreadsheet formula injection
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows, cols) =>
  [cols.map((c) => cell(c.label)).join(",")]
    .concat(rows.map((r) => cols.map((c) => cell(r[c.key])).join(",")))
    .join("\r\n");

async function exportCsv(q) {
  const f = cleanFilters(q);
  if (q.type === "centres") {
    const rows = await model.getByCentre(f);
    return {
      name: `centre-breakdown_${f.from}_${f.to}.csv`,
      csv: toCsv(rows, [
        { key: "name", label: "Training centre" },
        { key: "collected", label: "Collected (SGD)" },
        { key: "outstanding", label: "Outstanding (SGD)" },
        { key: "transactions", label: "Transactions" },
      ]),
    };
  }
  const rows = await model.getTransactions(f);
  return {
    name: `transactions_${f.from}_${f.to}.csv`,
    csv: toCsv(rows, [
      { key: "paymentDate", label: "Date" },
      { key: "invoiceNo", label: "Invoice" },
      { key: "studentName", label: "Student" },
      { key: "centre", label: "Centre" },
      { key: "feeType", label: "Fee type" },
      { key: "method", label: "Method" },
      { key: "bankReference", label: "Bank reference" },
      { key: "amount", label: "Amount (SGD)" },
      { key: "verifiedBy", label: "Verified by" },
    ]),
  };
}

// small bundle every page needs (sidebar term box, centre dropdowns)
async function getMeta() {
  const [term, centres] = await Promise.all([
    model.getCurrentTerm(),
    model.getCentres(),
  ]);
  let termInfo = null;
  if (term) {
    const today = ymd(new Date());
    const status =
      today < term.startDate
        ? "Upcoming"
        : today > term.endDate
          ? "Ended"
          : "In progress";
    const range = `${short(term.startDate)} – ${short(term.endDate)}`;
    termInfo = { termId: term.termId, name: term.name, range, status };
  }
  return {
    term: termInfo,
    centres,
    feeTypes: FEE_TYPES,
    user: { name: "Mei Lin" },
  };
}

module.exports = { getReport, getTransactions, exportCsv, getMeta };

// Shared sidebar + topbar + helpers for the new pages.
// Each page: <body data-page="financial|documents" data-crumbs="Administration|Financial reports">
const U = {
  esc: (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  money: (n) =>
    "$" + Number(n || 0).toLocaleString("en-SG", { maximumFractionDigits: 2 }),
  num: (n) => Number(n || 0).toLocaleString("en-SG"),
  day: (iso) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
  dayLong: (iso) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  time: (iso) =>
    new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  size(b) {
    b = Number(b || 0);
    if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
    return Math.max(1, Math.round(b / 1024)) + " KB";
  },
  ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  debounce(fn, ms = 300) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  },
  async api(url, opts = {}) {
    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* not json */
    }
    if (!res.ok)
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },
  qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") p.set(k, v);
    });
    return p.toString();
  },
};

const ICONS = {
  overview:
    '<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>',
  schedule:
    '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>',
  grading:
    '<circle cx="8" cy="6" r="3.5"/><path d="M5.5 9l-1 5 3.5-2 3.5 2-1-5"/>',
  results:
    '<path d="M2 4l1.2 1.2L5.5 3M2 8.5l1.2 1.2L5.5 7.5M2 13l1.2 1.2L5.5 12M8 4h6M8 8.5h6M8 13h6"/>',
  payments:
    '<rect x="2" y="4" width="12" height="9" rx="1.5"/><path d="M2 7h12M10.5 10.5h1.5"/>',
  documents:
    '<path d="M2 4.5a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z"/>',
  financial: '<path d="M2 13V9M6 13V6M10 13V8M14 13V3"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  bell: '<path d="M4 11V7a4 4 0 018 0v4l1 1.5H3zM6.5 14h3"/>',
  upload: '<path d="M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11"/>',
  download: '<path d="M8 2.5V11M4.5 7.5L8 11l3.5-3.5M2.5 13.5h11"/>',
  open: '<path d="M9 2.5h4.5V7M13.5 2.5L7 9M11 9.5v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V6a1 1 0 011-1h3"/>',
  building:
    '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M6 5h1M9 5h1M6 8h1M9 8h1M7 14v-3h2v3"/>',
};
const icon = (n) => `<svg viewBox="0 0 16 16">${ICONS[n] || ""}</svg>`;
window.icon = icon;

const NAV = [
  ["overview", "Overview", "index.html"],
  ["schedule", "Class schedule", "#"],
  ["grading", "Grading sessions", "Grading-sessions.html"],
  ["results", "Results & promotions", "Results.html"],
  ["payments", "Payments", "payments.html"],
  ["documents", "Documents & records", "documents.html"],
  ["financial", "Financial reports", "financial-reports.html"],
];

async function bootShell() {
  const page = document.body.dataset.page;
  const crumbs = (document.body.dataset.crumbs || "Administration").split("|");
  let meta = {
    term: null,
    centres: [],
    feeTypes: [],
    user: { name: "Mei Lin" },
  };
  try {
    meta = await U.api("/api/finance/meta");
  } catch (e) {
    console.error(e);
  }

  const initials = meta.user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const t = meta.term;
  document.getElementById("sidebar").innerHTML = `
    <div class="brand"><div class="brand-mark"></div><div><b>AIKIDO SHINJUKAI</b><small>ADMINISTRATION</small></div></div>
    <div class="nav-label">WORKSPACE</div>
    <nav class="nav">${NAV.map(
      ([k, label, href]) =>
        `<a href="${href}" class="${k === page ? "active" : ""}">${icon(k)}${label}</a>`,
    ).join("")}</nav>
    ${t ? `<div class="term-box"><b>${U.esc(t.name)}</b><span class="dates">${U.esc(t.range)}</span><span class="pill">${U.esc(t.status)}</span></div>` : ""}
    <div class="side-foot">Help &amp; resources ↗<br><br>One practice. Connected.</div>`;

  document.getElementById("topbar").innerHTML = `
    <div>${crumbs.map((c, i) => (i ? '<span class="crumb-sep">/</span>' : "") + U.esc(c)).join("")}</div>
    <div class="right">${icon("search")}${icon("bell")}<span class="avatar">${U.esc(initials)}</span>${U.esc(meta.user.name)}</div>`;
  return meta;
}
window.U = U;
window.bootShell = bootShell;

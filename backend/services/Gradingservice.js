const model = require("../models/Gradingmodel");
const httpError = require("../utils/HttpError");

const TYPES = ["Mass", "Private"];
const toId = (v) => (/^\d+$/.test(String(v || "")) ? parseInt(v, 10) : null);

function cleanFilters(q) {
  return {
    termId: toId(q.termId),
    centreId: toId(q.centreId),
    type: TYPES.includes(q.type) ? q.type : null,
    search: (q.search || "").trim().slice(0, 100) || null,
    tab: q.tab === "completed" ? "completed" : "upcoming",
  };
}

// GET /sessions -> { sessions, counts }
async function listSessions(q) {
  const f = cleanFilters(q);
  const [sessions, counts] = await Promise.all([
    model.listSessions(f),
    model.countSessions(f),
  ]);
  return { tab: f.tab, counts, sessions };
}

// GET /sessions/:id
async function getSession(id) {
  const sessionId = toId(id);
  if (!sessionId) throw httpError(400, "Invalid session id");
  const s = await model.getSession(sessionId);
  if (!s) throw httpError(404, "Grading session not found");
  return s;
}

// GET /results/pending-summary -> banner on screen 06 + Overview
async function pendingSummary() {
  const sessions = await model.pendingResultsSummary();
  const total = sessions.reduce((n, s) => n + s.pending, 0);
  return { total, sessions };
}

const getOptions = () => model.getOptions();

module.exports = { listSessions, getSession, pendingSummary, getOptions };
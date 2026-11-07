const model = require("../models/Gradingmodel");
const httpError = require("../utils/HttpError");
const buildPromotionEmail = require("../utils/PromotionEmail");

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

/* SCHEDULE / EDIT SESSIONS (screen 07) */

const todayYmd = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, server local time

// Checks that don't need the database
function checkSessionRules(b) {
  if (b.endTime <= b.startTime) throw httpError(400, "End time must be after start time");
  if (b.registrationCloses && b.registrationCloses > b.sessionDate)
    throw httpError(400, "Registration must close on or before the session date");
  if (b.supportingExaminerId && b.supportingExaminerId === b.leadExaminerId)
    throw httpError(400, "Supporting examiner must be different from the lead examiner");
}

async function checkReferences(b) {
  const checks = [model.centreExists(b.centreId), model.instructorExists(b.leadExaminerId)];
  if (b.supportingExaminerId) checks.push(model.instructorExists(b.supportingExaminerId));
  const [centre, lead, support = true] = await Promise.all(checks);
  if (!centre) throw httpError(400, "Selected centre does not exist");
  if (!lead || !support) throw httpError(400, "Selected examiner does not exist");
}

async function assertNoConflicts(b) {
  const conflicts = await model.findConflicts(b);
  if (conflicts.length) {
    const c = conflicts[0];
    throw httpError(409, `Conflict: ${c.who} - ${c.title} (${c.startTime}-${c.endTime})`);
  }
}

// POST /sessions/check-availability
async function checkAvailability(b) {
  if (b.endTime <= b.startTime) return { available: false, conflicts: [] };
  const conflicts = await model.findConflicts(b);
  return { available: conflicts.length === 0, conflicts };
}

// POST /sessions
async function createSession(b) {
  checkSessionRules(b);
  if (b.sessionDate < todayYmd()) throw httpError(400, "Session date can't be in the past");
  await checkReferences(b);

  let student = null;
  if (b.type === "Private") {
    student = await model.getStudentForGrading(b.studentId);
    if (!student) throw httpError(400, "Selected student does not exist");
    if (!student.nextBeltId) throw httpError(400, `${student.name} is already at the highest belt`);
    b.capacity = 1; // private grading = one student
  }

  await assertNoConflicts(b);
  const sessionId = await model.createSession(b, student);
  return model.getSession(sessionId);
}

// PUT /sessions/:id  (type can't be changed after creation)
async function updateSession(id, b) {
  const existing = await getSession(id);
  if (!["Draft", "Confirmed"].includes(existing.status))
    throw httpError(409, "Completed or cancelled sessions can't be edited");

  b.type = existing.type;
  if (existing.type === "Private") b.capacity = 1;
  checkSessionRules(b);
  if (b.capacity < existing.registered)
    throw httpError(400, `Capacity can't be lower than the ${existing.registered} students already registered`);
  await checkReferences(b);

  await assertNoConflicts({ ...b, excludeSessionId: existing.sessionId });
  await model.updateSession(existing.sessionId, b);
  return model.getSession(existing.sessionId);
}

/* RESULTS */

const resultSessions = () => model.sessionsWithResults();

// GET /results?sessionId=&tab=review|published
async function listResults(q) {
  const sessionId = toId(q.sessionId);
  if (!sessionId) throw httpError(400, "sessionId is required");
  const status = q.tab === "published" ? "Published" : "Draft";
  const results = await model.listResults(sessionId, status);
  return { sessionId, tab: status === "Draft" ? "review" : "published", results };
}

async function getResult(id) {
  const resultId = toId(id);
  if (!resultId) throw httpError(400, "Invalid result id");
  const r = await model.getResult(resultId);
  if (!r) throw httpError(404, "Result not found");
  return r;
}

// PUT /results/:id  (body already validated by middleware)
async function updateResult(id, body) {
  const r = await getResult(id);
  if (r.status === "Published")
    throw httpError(409, "This result is already published and can't be edited");

  let newBeltId = r.currentBeltId; // only a Pass changes the belt
  if (body.result === "Pass") {
    newBeltId = body.newBeltId || r.targetBeltId;
    const [current, next] = await Promise.all([
      model.getBelt(r.currentBeltId),
      model.getBelt(newBeltId),
    ]);
    if (!next) throw httpError(400, "Selected belt does not exist");
    if (next.rankOrder <= current.rankOrder)
      throw httpError(400, "A passing result must move the student to a higher belt");
  }

  await model.updateResult(r.resultId, {
    result: body.result,
    newBeltId,
    feedback: body.feedback || null,
    reviewedById: body.reviewedById || null,
  });
  return getResult(r.resultId);
}

// GET /results/:id/email-preview
async function emailPreview(id) {
  const r = await getResult(id);
  if (r.result !== "Pass" || r.newBeltId === r.currentBeltId)
    return { willSend: false, reason: "Only passing results that change the belt get an email" };
  const session = await model.getSession(r.sessionId);
  return {
    willSend: true,
    to: r.email,
    ...buildPromotionEmail({
      studentName: r.studentName,
      newBeltName: r.newBelt,
      sessionDate: session && session.sessionDate,
    }),
  };
}

// POST /results/publish { resultIds, sendEmails }
async function publishResults(body) {
  const out = await model.publishResults(
    body.resultIds,
    body.sendEmails,
    buildPromotionEmail,
  );
  if (!out) throw httpError(409, "None of the selected results are waiting for review");

  const count = (res) => out.rows.filter((r) => r.result === res).length;
  return {
    published: out.rows.length,
    promotions: out.promotions,
    beltRecordsUpdated: out.promotions,
    reassessments: count("Reassess"),
    failed: count("Fail"),
    emailsQueued: out.emailsQueued,
    skipped: body.resultIds.length - out.rows.length, // already published / not found
  };
}

/* NOTIFICATIONS */

async function listNotifications(q) {
  const limit = Math.min(toId(q.limit) || 50, 200);
  return model.listNotifications(toId(q.sessionId), limit);
}

// POST /notifications/:id/resend { email? }
async function resendNotification(id, body) {
  const notificationId = toId(id);
  if (!notificationId) throw httpError(400, "Invalid notification id");
  const n = await model.getNotification(notificationId);
  if (!n) throw httpError(404, "Notification not found");
  if (n.status === "Delivered" && !body.email)
    throw httpError(409, "This email was already delivered");
  await model.requeueNotification(notificationId, body.email || null);
  return { notificationId, status: "Queued" };
}

module.exports = {
  listSessions,
  getSession,
  pendingSummary,
  getOptions,
  checkAvailability,
  createSession,
  updateSession,
  resultSessions,
  listResults,
  getResult,
  updateResult,
  emailPreview,
  publishResults,
  listNotifications,
  resendNotification,
};
const sql = require("mssql");
const { getPool } = require("../dbConfig");

// Shared SELECT for a session row (with names + live registered count)
const SESSION_SELECT = `
  SELECT s.sessionId, s.code, s.title, s.type, s.sessionStatus AS status,
         s.termId, s.centreId, c.name AS centreName, s.venue,
         CONVERT(varchar(10), s.sessionDate, 23) AS sessionDate,
         CONVERT(varchar(5), s.startTime, 108) AS startTime,
         CONVERT(varchar(5), s.endTime, 108) AS endTime,
         s.capacity, s.fee,
         CONVERT(varchar(10), s.registrationCloses, 23) AS registrationCloses,
         s.leadExaminerId, le.name AS leadExaminer,
         s.supportingExaminerId, se.name AS supportingExaminer,
         (SELECT COUNT(*) FROM GradingRegistrations r WHERE r.sessionId = s.sessionId) AS registered
  FROM GradingSessions s
  JOIN Centres c ON c.centreId = s.centreId
  LEFT JOIN Instructors le ON le.instructorId = s.leadExaminerId
  LEFT JOIN Instructors se ON se.instructorId = s.supportingExaminerId`;

// "Upcoming" = today or later and not completed/cancelled; everything else is "Completed"
const UPCOMING = `(s.sessionDate >= CAST(GETDATE() AS date) AND s.sessionStatus IN ('Draft','Confirmed'))`;

const FILTER_WHERE = `
  (@termId IS NULL OR s.termId = @termId)
  AND (@centreId IS NULL OR s.centreId = @centreId)
  AND (@type IS NULL OR s.type = @type)
  AND (@search IS NULL OR s.title LIKE @search OR s.code LIKE @search)`;

function bind(req, f) {
  return req
    .input("termId", sql.Int, f.termId)
    .input("centreId", sql.Int, f.centreId)
    .input("type", sql.VarChar(10), f.type)
    .input("search", sql.VarChar(100), f.search ? `%${f.search}%` : null);
}

async function listSessions(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    ${SESSION_SELECT}
    WHERE ${FILTER_WHERE}
      AND ${f.tab === "completed" ? `NOT ${UPCOMING}` : UPCOMING}
    ORDER BY s.sessionDate ${f.tab === "completed" ? "DESC" : "ASC"}, s.startTime`);
  return r.recordset;
}

async function countSessions(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    SELECT
      SUM(CASE WHEN ${UPCOMING} THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN ${UPCOMING} THEN 0 ELSE 1 END) AS completed
    FROM GradingSessions s
    WHERE ${FILTER_WHERE}`);
  const row = r.recordset[0];
  return { upcoming: row.upcoming || 0, completed: row.completed || 0 };
}

async function getSession(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`${SESSION_SELECT} WHERE s.sessionId = @id`);
  return r.recordset[0] || null;
}

// For the "October results are ready" banner: sessions with results still in Draft
async function pendingResultsSummary() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT s.sessionId, s.code, s.title, c.name AS centreName,
           CONVERT(varchar(10), s.sessionDate, 23) AS sessionDate,
           COUNT(*) AS pending
    FROM GradingResults gr
    JOIN GradingSessions s ON s.sessionId = gr.sessionId
    JOIN Centres c ON c.centreId = s.centreId
    WHERE gr.status = 'Draft' AND gr.registrationId IS NOT NULL
    GROUP BY s.sessionId, s.code, s.title, c.name, s.sessionDate
    ORDER BY s.sessionDate DESC`);
  return r.recordset;
}

// Dropdown options for the filters
async function getOptions() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT termId AS id, name FROM Terms ORDER BY startDate DESC;
    SELECT centreId AS id, name FROM Centres ORDER BY name;
    SELECT instructorId AS id, name FROM Instructors ORDER BY name;`);
  const [terms, centres, instructors] = r.recordsets;
  return { terms, centres, instructors, types: ["Mass", "Private"] };
}

module.exports = {
  listSessions,
  countSessions,
  getSession,
  pendingResultsSummary,
  getOptions,
};
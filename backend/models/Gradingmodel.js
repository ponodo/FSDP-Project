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
    SELECT instructorId AS id, name FROM Instructors ORDER BY name;
    SELECT beltId AS id, name, colour, rankOrder FROM BeltRanks ORDER BY rankOrder;`);
  const [terms, centres, instructors, belts] = r.recordsets;
  return { terms, centres, instructors, belts, types: ["Mass", "Private"] };
}

/* ===================== RESULTS (screen 08) ===================== */

// One row per result, with current -> new belt and the latest email status
const RESULT_SELECT = `
  SELECT gr.resultId, gr.sessionId, gr.studentId, st.name AS studentName, st.memberCode, st.email,
         reg.currentBeltId, cb.name AS currentBelt, gr.newBeltId, nb.name AS newBelt,
         reg.targetBeltId, tb.name AS targetBelt,
         gr.result, gr.feedback, gr.status,
         gr.reviewedById, rv.name AS reviewedBy, gr.reviewedAt, gr.publishedAt,
         n.notificationId, n.status AS emailStatus, n.sentAt AS emailSentAt,
         n.nextRetryAt AS emailNextRetryAt, n.lastError AS emailError
  FROM GradingResults gr
  JOIN GradingRegistrations reg ON reg.registrationId = gr.registrationId
  JOIN Students st ON st.studentId = gr.studentId
  JOIN BeltRanks cb ON cb.beltId = reg.currentBeltId
  JOIN BeltRanks tb ON tb.beltId = reg.targetBeltId
  LEFT JOIN BeltRanks nb ON nb.beltId = gr.newBeltId
  LEFT JOIN Instructors rv ON rv.instructorId = gr.reviewedById
  OUTER APPLY (SELECT TOP 1 * FROM EmailNotifications e
               WHERE e.resultId = gr.resultId ORDER BY e.createdAt DESC) n`;

// Sessions that have results (for the session dropdown on screen 08)
async function sessionsWithResults() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT s.sessionId, s.code, s.title, c.name AS centreName,
           CONVERT(varchar(10), s.sessionDate, 23) AS sessionDate,
           SUM(CASE WHEN gr.status = 'Draft' THEN 1 ELSE 0 END) AS needsReview,
           SUM(CASE WHEN gr.status = 'Published' THEN 1 ELSE 0 END) AS published
    FROM GradingResults gr
    JOIN GradingSessions s ON s.sessionId = gr.sessionId
    JOIN Centres c ON c.centreId = s.centreId
    WHERE gr.registrationId IS NOT NULL
    GROUP BY s.sessionId, s.code, s.title, c.name, s.sessionDate
    ORDER BY s.sessionDate DESC`);
  return r.recordset;
}

async function listResults(sessionId, status) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("sessionId", sql.Int, sessionId)
    .input("status", sql.VarChar(12), status)
    .query(`${RESULT_SELECT}
      WHERE gr.sessionId = @sessionId AND gr.status = @status
      ORDER BY st.name`);
  return r.recordset;
}

async function getResult(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`${RESULT_SELECT} WHERE gr.resultId = @id`);
  return r.recordset[0] || null;
}

async function getBelt(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT beltId, name, rankOrder FROM BeltRanks WHERE beltId = @id`);
  return r.recordset[0] || null;
}

async function updateResult(id, d) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .input("result", sql.VarChar(10), d.result)
    .input("newBeltId", sql.Int, d.newBeltId)
    .input("feedback", sql.VarChar(500), d.feedback)
    .input("reviewedById", sql.Int, d.reviewedById)
    .query(`
      UPDATE GradingResults
      SET result = @result, newBeltId = @newBeltId, feedback = @feedback,
          reviewedById = COALESCE(@reviewedById, reviewedById), reviewedAt = SYSDATETIME()
      WHERE resultId = @id AND status = 'Draft'`);
  return r.rowsAffected[0];
}

/*
  Publish = ONE transaction. For each selected Draft result:
    - Pass with a higher belt -> update Students.currentBeltId, insert Promotions,
      queue a congratulatory email (if sendEmails)
    - every result -> status 'Published'
  If anything fails, everything rolls back.
*/
async function publishResults(ids, sendEmails, buildEmail) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = new sql.Request(tx);
    const list = ids
      .map((id, i) => {
        req.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      })
      .join(",");

    // UPDLOCK stops two admins publishing the same results at the same time
    const rows = (
      await req.query(`
        SELECT gr.resultId, gr.result, gr.studentId, st.name AS studentName, st.email,
               st.currentBeltId, cur.rankOrder AS currentRank,
               gr.newBeltId, nb.name AS newBeltName, nb.rankOrder AS newRank, s.sessionDate
        FROM GradingResults gr WITH (UPDLOCK, ROWLOCK)
        JOIN Students st ON st.studentId = gr.studentId
        JOIN BeltRanks cur ON cur.beltId = st.currentBeltId
        JOIN BeltRanks nb ON nb.beltId = gr.newBeltId
        JOIN GradingSessions s ON s.sessionId = gr.sessionId
        WHERE gr.resultId IN (${list}) AND gr.status = 'Draft'
          AND gr.registrationId IS NOT NULL AND gr.result IS NOT NULL`)
    ).recordset;

    if (!rows.length) {
      await tx.rollback();
      return null;
    }

    let promotions = 0;
    let emailsQueued = 0;
    for (const r of rows) {
      if (r.result !== "Pass" || r.newRank <= r.currentRank) continue;

      await new sql.Request(tx)
        .input("studentId", sql.Int, r.studentId)
        .input("resultId", sql.Int, r.resultId)
        .input("fromBeltId", sql.Int, r.currentBeltId)
        .input("toBeltId", sql.Int, r.newBeltId).query(`
          UPDATE Students SET currentBeltId = @toBeltId, beltSince = CAST(GETDATE() AS date)
          WHERE studentId = @studentId;
          INSERT INTO Promotions(studentId, resultId, fromBeltId, toBeltId)
          VALUES (@studentId, @resultId, @fromBeltId, @toBeltId);`);
      promotions++;

      if (sendEmails) {
        const email = buildEmail(r);
        await new sql.Request(tx)
          .input("studentId", sql.Int, r.studentId)
          .input("resultId", sql.Int, r.resultId)
          .input("toEmail", sql.VarChar(120), r.email)
          .input("subject", sql.VarChar(200), email.subject)
          .input("body", sql.VarChar(sql.MAX), email.body).query(`
            INSERT INTO EmailNotifications(studentId, resultId, toEmail, subject, body, nextRetryAt)
            VALUES (@studentId, @resultId, @toEmail, @subject, @body, SYSDATETIME())`);
        emailsQueued++;
      }
    }

    const done = new sql.Request(tx);
    const doneList = rows
      .map((r, i) => {
        done.input(`r${i}`, sql.Int, r.resultId);
        return `@r${i}`;
      })
      .join(",");
    await done.query(`
      UPDATE GradingResults SET status = 'Published', publishedAt = SYSDATETIME()
      WHERE resultId IN (${doneList})`);

    await tx.commit();
    return { rows, promotions, emailsQueued };
  } catch (err) {
    try {
      await tx.rollback();
    } catch (e) {
      /* already rolled back */
    }
    throw err;
  }
}

/* ===================== NOTIFICATIONS ===================== */

async function listNotifications(sessionId, limit) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("sessionId", sql.Int, sessionId)
    .input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit) n.notificationId, n.resultId, st.studentId, st.name AS studentName,
             nb.name AS updatedBelt, n.toEmail, n.subject, n.status, n.attempts,
             n.lastError, n.nextRetryAt, n.sentAt, n.createdAt
      FROM EmailNotifications n
      JOIN Students st ON st.studentId = n.studentId
      LEFT JOIN GradingResults gr ON gr.resultId = n.resultId
      LEFT JOIN BeltRanks nb ON nb.beltId = gr.newBeltId
      WHERE n.type = 'Promotion' AND (@sessionId IS NULL OR gr.sessionId = @sessionId)
      ORDER BY n.createdAt DESC, n.notificationId DESC`);
  return r.recordset;
}

async function getNotification(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT * FROM EmailNotifications WHERE notificationId = @id`);
  return r.recordset[0] || null;
}

// Re-queue a failed/queued email; optionally fix the address (also saved on the student)
async function requeueNotification(id, newEmail) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .input("email", sql.VarChar(120), newEmail).query(`
      UPDATE EmailNotifications
      SET toEmail = COALESCE(@email, toEmail), status = 'Queued', attempts = 0,
          lastError = NULL, nextRetryAt = SYSDATETIME()
      WHERE notificationId = @id;
      IF @email IS NOT NULL
        UPDATE Students SET email = @email
        WHERE studentId = (SELECT studentId FROM EmailNotifications WHERE notificationId = @id);`);
  return r.rowsAffected[0];
}

/* ===================== EMAIL WORKER ===================== */

// Queued emails whose retry time has come
async function getDueNotifications(limit) {
  const pool = await getPool();
  const r = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit) notificationId, toEmail, subject, body, attempts
    FROM EmailNotifications
    WHERE status = 'Queued' AND (nextRetryAt IS NULL OR nextRetryAt <= SYSDATETIME())
    ORDER BY createdAt`);
  return r.recordset;
}

async function markDelivered(id) {
  const pool = await getPool();
  await pool.request().input("id", sql.Int, id).query(`
    UPDATE EmailNotifications
    SET status = 'Delivered', attempts = attempts + 1, sentAt = SYSDATETIME(),
        lastError = NULL, nextRetryAt = NULL
    WHERE notificationId = @id`);
}

// Failed attempt: retry after `retryMinutes`, or give up after `maxAttempts` (or if permanent)
async function markAttemptFailed(id, error, maxAttempts, retryMinutes, permanent) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("error", sql.VarChar(300), String(error).slice(0, 300))
    .input("max", sql.Int, maxAttempts)
    .input("mins", sql.Int, retryMinutes)
    .input("permanent", sql.Bit, permanent ? 1 : 0).query(`
      UPDATE EmailNotifications
      SET attempts = attempts + 1, lastError = @error,
          status = CASE WHEN @permanent = 1 OR attempts + 1 >= @max THEN 'Failed' ELSE 'Queued' END,
          nextRetryAt = CASE WHEN @permanent = 1 OR attempts + 1 >= @max THEN NULL
                             ELSE DATEADD(MINUTE, @mins, SYSDATETIME()) END
      WHERE notificationId = @id`);
}

module.exports = {
  getDueNotifications,
  markDelivered,
  markAttemptFailed,
  listSessions,
  countSessions,
  getSession,
  pendingResultsSummary,
  getOptions,
  sessionsWithResults,
  listResults,
  getResult,
  getBelt,
  updateResult,
  publishResults,
  listNotifications,
  getNotification,
  requeueNotification,
};

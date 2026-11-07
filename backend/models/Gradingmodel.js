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
    .query(`${SESSION_SELECT} WHERE s.sessionId = @id;
            SELECT st.studentId AS id, st.name, st.memberCode, cb.name AS currentBelt, tb.name AS targetBelt
            FROM GradingRegistrations reg
            JOIN Students st ON st.studentId = reg.studentId
            JOIN BeltRanks cb ON cb.beltId = reg.currentBeltId
            JOIN BeltRanks tb ON tb.beltId = reg.targetBeltId
            WHERE reg.sessionId = @id ORDER BY st.name`);
  const s = r.recordsets[0][0];
  return s ? { ...s, students: r.recordsets[1] } : null;
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
    SELECT beltId AS id, name, colour, rankOrder FROM BeltRanks ORDER BY rankOrder;
    SELECT st.studentId AS id, st.name, st.memberCode, st.centreId, b.name AS currentBelt
    FROM Students st JOIN BeltRanks b ON b.beltId = st.currentBeltId
    WHERE b.rankOrder < (SELECT MAX(rankOrder) FROM BeltRanks)   -- can still be promoted
    ORDER BY st.name;
    SELECT DISTINCT centreId, venue FROM (
      SELECT centreId, venue FROM Classes UNION SELECT centreId, venue FROM GradingSessions
    ) v WHERE venue IS NOT NULL ORDER BY venue;`);
  const [terms, centres, instructors, belts, students, spaces] = r.recordsets;
  return { terms, centres, instructors, belts, students, spaces, types: ["Mass", "Private"] };
}

/* ===================== SCHEDULE / EDIT (screen 07) ===================== */

function bindSlot(req, b) {
  return req
    .input("centreId", sql.Int, b.centreId)
    .input("venue", sql.VarChar(50), b.venue)
    .input("date", sql.VarChar(10), b.sessionDate)
    .input("start", sql.VarChar(5), b.startTime)
    .input("end", sql.VarChar(5), b.endTime)
    .input("lead", sql.Int, b.leadExaminerId)
    .input("support", sql.Int, b.supportingExaminerId || null)
    .input("excludeId", sql.Int, b.excludeSessionId || null);
}

// Other gradings and classes that clash with this time slot (same space or same examiner)
async function findConflicts(b) {
  const pool = await getPool();
  const r = await bindSlot(pool.request(), b).query(`
    DECLARE @s TIME = CAST(@start AS time), @e TIME = CAST(@end AS time), @d DATE = CAST(@date AS date);

    -- other grading sessions
    SELECT 'space' AS kind, c.name + ' - ' + g.venue AS who, g.title,
           CONVERT(varchar(5), g.startTime, 108) AS startTime, CONVERT(varchar(5), g.endTime, 108) AS endTime
    FROM GradingSessions g JOIN Centres c ON c.centreId = g.centreId
    WHERE g.sessionDate = @d AND g.sessionStatus IN ('Draft','Confirmed')
      AND (@excludeId IS NULL OR g.sessionId <> @excludeId)
      AND g.startTime < @e AND @s < g.endTime
      AND g.centreId = @centreId AND g.venue = @venue
    UNION ALL
    SELECT 'examiner', i.name, g.title,
           CONVERT(varchar(5), g.startTime, 108), CONVERT(varchar(5), g.endTime, 108)
    FROM GradingSessions g
    JOIN Instructors i ON i.instructorId IN (g.leadExaminerId, g.supportingExaminerId)
    WHERE g.sessionDate = @d AND g.sessionStatus IN ('Draft','Confirmed')
      AND (@excludeId IS NULL OR g.sessionId <> @excludeId)
      AND g.startTime < @e AND @s < g.endTime
      AND i.instructorId IN (@lead, @support)

    -- classes in the same space or taught by the examiner
    UNION ALL
    SELECT 'space', c.name + ' - ' + cl.venue, cl.title,
           CONVERT(varchar(5), cl.startTime, 108),
           CONVERT(varchar(5), DATEADD(MINUTE, cl.durationMin, cl.startTime), 108)
    FROM Classes cl JOIN Centres c ON c.centreId = cl.centreId
    WHERE cl.classDate = @d AND cl.centreId = @centreId AND cl.venue = @venue
      AND cl.startTime < @e AND @s < DATEADD(MINUTE, cl.durationMin, cl.startTime)
    UNION ALL
    SELECT 'examiner', i.name, cl.title,
           CONVERT(varchar(5), cl.startTime, 108),
           CONVERT(varchar(5), DATEADD(MINUTE, cl.durationMin, cl.startTime), 108)
    FROM Classes cl JOIN Instructors i ON i.instructorId = cl.instructorId
    WHERE cl.classDate = @d AND cl.instructorId IN (@lead, @support)
      AND cl.startTime < @e AND @s < DATEADD(MINUTE, cl.durationMin, cl.startTime)
    ORDER BY startTime`);
  return r.recordset;
}

async function getStudentForGrading(studentId) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, studentId).query(`
    SELECT st.studentId, st.name, st.centreId, st.currentBeltId,
           (SELECT TOP 1 nb.beltId FROM BeltRanks nb
            WHERE nb.rankOrder > b.rankOrder ORDER BY nb.rankOrder) AS nextBeltId
    FROM Students st JOIN BeltRanks b ON b.beltId = st.currentBeltId
    WHERE st.studentId = @id`);
  return r.recordset[0] || null;
}

function bindSession(req, b) {
  return bindSlot(req, b)
    .input("type", sql.VarChar(10), b.type)
    .input("title", sql.VarChar(80), b.title)
    .input("capacity", sql.Int, b.capacity)
    .input("fee", sql.Decimal(10, 2), b.fee || 0)
    .input("closes", sql.VarChar(10), b.registrationCloses || null);
}

// Insert the session; a private grading also registers its one student (in one transaction)
async function createSession(b, student) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = await bindSession(new sql.Request(tx), b).query(`
      DECLARE @d DATE = CAST(@date AS date);
      INSERT INTO GradingSessions
        (centreId, type, title, sessionDate, startTime, endTime, venue, leadExaminer, capacity, registered,
         code, termId, fee, registrationCloses, leadExaminerId, supportingExaminerId, sessionStatus)
      OUTPUT INSERTED.sessionId
      VALUES (@centreId, @type, @title, @d, CAST(@start AS time), CAST(@end AS time), @venue,
        (SELECT name FROM Instructors WHERE instructorId = @lead), @capacity, 0,
        CONCAT('GR-', FORMAT(@d, 'yyyy-MMdd')),
        (SELECT TOP 1 termId FROM Terms WHERE @d BETWEEN startDate AND endDate ORDER BY startDate DESC),
        @fee, CAST(@closes AS date), @lead, @support, 'Confirmed')`);
    const sessionId = r.recordset[0].sessionId;

    if (student) {
      await new sql.Request(tx)
        .input("sessionId", sql.Int, sessionId)
        .input("studentId", sql.Int, student.studentId)
        .input("current", sql.Int, student.currentBeltId)
        .input("target", sql.Int, student.nextBeltId)
        .query(`INSERT INTO GradingRegistrations(sessionId, studentId, currentBeltId, targetBeltId)
                VALUES (@sessionId, @studentId, @current, @target);
                UPDATE GradingSessions SET registered = 1 WHERE sessionId = @sessionId;`);
    }
    await tx.commit();
    return sessionId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function updateSession(id, b) {
  const pool = await getPool();
  await bindSession(pool.request(), b)
    .input("id", sql.Int, id)
    .query(`
      DECLARE @d DATE = CAST(@date AS date);
      UPDATE GradingSessions SET
        title = @title, centreId = @centreId, venue = @venue, sessionDate = @d,
        startTime = CAST(@start AS time), endTime = CAST(@end AS time),
        capacity = @capacity, fee = @fee, registrationCloses = CAST(@closes AS date),
        leadExaminerId = @lead, supportingExaminerId = @support,
        leadExaminer = (SELECT name FROM Instructors WHERE instructorId = @lead),
        code = CONCAT('GR-', FORMAT(@d, 'yyyy-MMdd')),
        termId = (SELECT TOP 1 termId FROM Terms WHERE @d BETWEEN startDate AND endDate ORDER BY startDate DESC)
      WHERE sessionId = @id`);
}

async function instructorExists(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT 1 AS ok FROM Instructors WHERE instructorId = @id");
  return r.recordset.length > 0;
}

async function centreExists(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT 1 AS ok FROM Centres WHERE centreId = @id");
  return r.recordset.length > 0;
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
  findConflicts,
  getStudentForGrading,
  createSession,
  updateSession,
  instructorExists,
  centreExists,
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

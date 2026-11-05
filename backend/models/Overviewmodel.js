const sql = require("mssql");
const { getPool } = require("../dbConfig");

const req = async (centreId) => (await getPool()).request().input("centreId", sql.Int, centreId);
const MONTH_START = "DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)";

async function money(centreId) {
  const r = await (await req(centreId)).query(`
    SELECT
      (SELECT ISNULL(SUM(p.amount),0) FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId
        WHERE p.paymentDate >= ${MONTH_START} AND p.paymentDate < DATEADD(MONTH,1,${MONTH_START})
          AND (@centreId IS NULL OR i.centreId=@centreId)) AS collected,
      (SELECT ISNULL(SUM(i.amount),0) FROM Invoices i
        WHERE i.issueDate >= ${MONTH_START} AND i.issueDate < DATEADD(MONTH,1,${MONTH_START})
          AND (@centreId IS NULL OR i.centreId=@centreId)) AS invoiced`);
  const o = await (await req(centreId)).query(`
    SELECT ISNULL(SUM(ob.balance),0) AS outstanding, COUNT(*) AS invoiceCount,
           ISNULL(SUM(CASE WHEN ob.dueDate < CAST(GETDATE() AS date) THEN 1 ELSE 0 END),0) AS overdue
    FROM (SELECT i.dueDate,
            i.amount - ISNULL((SELECT SUM(x.amount) FROM Payments x WHERE x.invoiceId=i.invoiceId),0) AS balance
          FROM Invoices i WHERE i.status <> 'Paid' AND (@centreId IS NULL OR i.centreId=@centreId)) ob
    WHERE ob.balance > 0`);
  return { ...r.recordset[0], ...o.recordset[0] };
}

async function todayClasses(centreId) {
  const r = await (await req(centreId)).query(`
    SELECT TOP 12 c.classId, c.title, c.venue, ce.name AS centre, ins.name AS instructor,
      CONVERT(varchar(5), c.startTime, 108) AS startTime, c.durationMin, c.capacity, c.enrolled
    FROM Classes c
    JOIN Centres ce ON ce.centreId=c.centreId
    LEFT JOIN Instructors ins ON ins.instructorId=c.instructorId
    WHERE c.classDate = CAST(GETDATE() AS date) AND (@centreId IS NULL OR c.centreId=@centreId)
    ORDER BY c.startTime`);
  const t = await (await req(centreId)).query(
    "SELECT COUNT(*) AS n FROM Classes WHERE classDate=CAST(GETDATE() AS date) AND (@centreId IS NULL OR centreId=@centreId)");
  return { rows: r.recordset, total: t.recordset[0].n };
}

async function attention(centreId) {
  const r = await (await req(centreId)).query(`
    SELECT
      (SELECT COUNT(*) FROM Invoices WHERE status='Reported' AND (@centreId IS NULL OR centreId=@centreId)) AS reported,
      (SELECT COUNT(*) FROM GradingResults gr JOIN GradingSessions s ON s.sessionId=gr.sessionId
        WHERE gr.status='Draft' AND (@centreId IS NULL OR s.centreId=@centreId)) AS drafts,
      (SELECT COUNT(*) FROM Classes a JOIN Classes b
          ON a.instructorId=b.instructorId AND a.classDate=b.classDate AND a.classId<b.classId
         AND a.startTime < DATEADD(MINUTE,b.durationMin,b.startTime)
         AND b.startTime < DATEADD(MINUTE,a.durationMin,a.startTime)
        WHERE a.classDate >= CAST(GETDATE() AS date)
          AND (@centreId IS NULL OR a.centreId=@centreId OR b.centreId=@centreId)) AS conflicts`);
  return r.recordset[0];
}

async function nextGrading(centreId) {
  const r = await (await req(centreId)).query(`
    SELECT TOP 1 s.sessionId, s.type, s.title, CONVERT(varchar(10), s.sessionDate, 23) AS sessionDate,
      CONVERT(varchar(5), s.startTime, 108) AS startTime, CONVERT(varchar(5), s.endTime, 108) AS endTime,
      s.venue, s.leadExaminer, s.capacity, s.registered, ce.name AS centre
    FROM GradingSessions s JOIN Centres ce ON ce.centreId=s.centreId
    WHERE s.sessionDate >= CAST(GETDATE() AS date) AND (@centreId IS NULL OR s.centreId=@centreId)
    ORDER BY s.sessionDate, s.startTime`);
  return r.recordset[0] || null;
}

/* ---- student portal ---- */
async function portalStudent(userId) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, userId).query(`
    SELECT u.userId, u.fullName, u.centreId, ce.name AS centre, s.studentId, s.studentCode
    FROM Users u LEFT JOIN Centres ce ON ce.centreId=u.centreId LEFT JOIN Students s ON s.studentId=u.studentId
    WHERE u.userId=@id`);
  return r.recordset[0] || null;
}

async function portalInvoices(studentId) {
  const pool = await getPool();
  const r = await pool.request().input("sid", sql.Int, studentId).query(`
    SELECT TOP 20 ISNULL(i.invoiceNo, 'INV-' + CAST(i.invoiceId AS varchar(10))) AS invoiceNo, i.feeType, i.amount,
      CONVERT(varchar(10), i.dueDate, 23) AS dueDate, i.status
    FROM Invoices i WHERE i.studentId=@sid ORDER BY i.issueDate DESC, i.invoiceId DESC`);
  return r.recordset;
}

async function portalClasses(centreId) {
  const pool = await getPool();
  const r = await pool.request().input("centreId", sql.Int, centreId).query(`
    SELECT TOP 8 c.title, c.venue, ins.name AS instructor, CONVERT(varchar(10), c.classDate, 23) AS classDate,
      CONVERT(varchar(5), c.startTime, 108) AS startTime, c.durationMin
    FROM Classes c LEFT JOIN Instructors ins ON ins.instructorId=c.instructorId
    WHERE c.centreId=@centreId AND c.classDate >= CAST(GETDATE() AS date) AND c.classDate < DATEADD(DAY,14,CAST(GETDATE() AS date))
    ORDER BY c.classDate, c.startTime`);
  return r.recordset;
}

module.exports = { money, todayClasses, attention, nextGrading, portalStudent, portalInvoices, portalClasses };

const sql = require("mssql");
const { getPool } = require("../dbConfig");

function bind(req, f) {
  return req
    .input("from", sql.VarChar(10), f.from)
    .input("to", sql.VarChar(10), f.to)
    .input("centreId", sql.Int, f.centreId)
    .input("feeType", sql.VarChar(40), f.feeType);
}

const PAY_WHERE = `
  p.paymentDate >= CONVERT(date,@from,23) AND p.paymentDate < DATEADD(DAY,1,CONVERT(date,@to,23))
  AND (@centreId IS NULL OR i.centreId = @centreId)
  AND (@feeType IS NULL OR i.feeType = @feeType)`;
const INV_WHERE = `
  i.issueDate >= CONVERT(date,@from,23) AND i.issueDate < DATEADD(DAY,1,CONVERT(date,@to,23))
  AND (@centreId IS NULL OR i.centreId = @centreId)
  AND (@feeType IS NULL OR i.feeType = @feeType)
  AND i.status <> 'Paid'`;
// unpaid invoices with their remaining balance (derived table, so SUM() works on a plain column)
const OPEN = `(SELECT i.invoiceId, i.centreId, i.issueDate,
    i.amount - ISNULL((SELECT SUM(x.amount) FROM Payments x WHERE x.invoiceId = i.invoiceId),0) AS balance
  FROM Invoices i WHERE ${INV_WHERE}) ob`;

async function getTotals(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    SELECT
      (SELECT ISNULL(SUM(p.amount),0) FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId WHERE ${PAY_WHERE}) AS collected,
      (SELECT COUNT(*) FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId WHERE ${PAY_WHERE}) AS paymentCount,
      (SELECT ISNULL(SUM(ob.balance),0) FROM ${OPEN}) AS outstanding,
      (SELECT COUNT(*) FROM ${OPEN} WHERE ob.balance > 0) AS unpaidCount`);
  return r.recordset[0];
}

async function getWeekly(f) {
  const pool = await getPool();
  const c = await bind(pool.request(), f).query(`
    SELECT DATEDIFF(DAY,CONVERT(date,@from,23),p.paymentDate)/7 AS wk, SUM(p.amount) AS total
    FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId WHERE ${PAY_WHERE}
    GROUP BY DATEDIFF(DAY,CONVERT(date,@from,23),p.paymentDate)/7`);
  const o = await bind(pool.request(), f).query(`
    SELECT DATEDIFF(DAY,CONVERT(date,@from,23),ob.issueDate)/7 AS wk, SUM(ob.balance) AS total
    FROM ${OPEN} WHERE ob.balance > 0
    GROUP BY DATEDIFF(DAY,CONVERT(date,@from,23),ob.issueDate)/7`);
  return { collected: c.recordset, outstanding: o.recordset };
}

async function getByMethod(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    SELECT p.method, SUM(p.amount) AS total
    FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId WHERE ${PAY_WHERE}
    GROUP BY p.method ORDER BY SUM(p.amount) DESC`);
  return r.recordset;
}

async function getByCentre(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    SELECT c.centreId, c.name,
      ISNULL((SELECT SUM(p.amount) FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId
              WHERE i.centreId=c.centreId AND ${PAY_WHERE}),0) AS collected,
      ISNULL((SELECT SUM(ob.balance) FROM ${OPEN} WHERE ob.centreId=c.centreId),0) AS outstanding,
      (SELECT COUNT(*) FROM Payments p JOIN Invoices i ON i.invoiceId=p.invoiceId
              WHERE i.centreId=c.centreId AND ${PAY_WHERE}) AS transactions
    FROM Centres c
    WHERE (@centreId IS NULL OR c.centreId = @centreId)
    ORDER BY c.centreId`);
  return r.recordset;
}

async function getTransactions(f) {
  const pool = await getPool();
  const r = await bind(pool.request(), f).query(`
    SELECT TOP 1000 p.paymentId, CONVERT(varchar(10),p.paymentDate,23) AS paymentDate,
      ISNULL(i.invoiceNo, 'INV-' + CAST(i.invoiceId AS varchar(10))) AS invoiceNo,
      s.name AS studentName, c.name AS centre, i.feeType,
      p.method, p.bankReference, p.amount, p.verifiedBy
    FROM Payments p
    JOIN Invoices i ON i.invoiceId = p.invoiceId
    JOIN Centres c ON c.centreId = i.centreId
    LEFT JOIN Students s ON s.studentId = i.studentId
    WHERE ${PAY_WHERE}
    ORDER BY p.paymentDate DESC, p.paymentId DESC`);
  return r.recordset;
}

async function getCurrentTerm() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT TOP 1 termId, name, CONVERT(varchar(10),startDate,23) AS startDate, CONVERT(varchar(10),endDate,23) AS endDate
    FROM Terms
    ORDER BY CASE WHEN CAST(GETDATE() AS date) BETWEEN startDate AND endDate THEN 0 ELSE 1 END,
             ABS(DATEDIFF(DAY, GETDATE(), startDate))`);
  return r.recordset[0] || null;
}

async function getCentres() {
  const pool = await getPool();
  return (
    await pool
      .request()
      .query("SELECT centreId, name FROM Centres ORDER BY centreId")
  ).recordset;
}

module.exports = {
  getTotals,
  getWeekly,
  getByMethod,
  getByCentre,
  getTransactions,
  getCurrentTerm,
  getCentres,
};

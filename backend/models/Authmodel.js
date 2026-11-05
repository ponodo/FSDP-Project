const sql = require("mssql");
const { getPool } = require("../dbConfig");

async function findByEmail(email) {
  const pool = await getPool();
  const r = await pool.request().input("email", sql.VarChar(120), email).query(
    "SELECT userId, fullName, email, passwordHash, role, centreId, studentId FROM Users WHERE email=@email");
  return r.recordset[0] || null;
}

async function findById(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id).query(
    "SELECT userId, fullName, email, role, centreId, studentId FROM Users WHERE userId=@id");
  return r.recordset[0] || null;
}

async function createUser(u) {
  const pool = await getPool();
  const r = await pool.request()
    .input("name", sql.VarChar(80), u.fullName).input("email", sql.VarChar(120), u.email)
    .input("hash", sql.VarChar(100), u.passwordHash).input("centreId", sql.Int, u.centreId)
    .input("studentId", sql.Int, u.studentId)
    .query(`INSERT INTO Users(fullName,email,passwordHash,role,centreId,studentId)
            OUTPUT INSERTED.userId, INSERTED.fullName, INSERTED.role
            VALUES (@name,@email,@hash,'Student',@centreId,@studentId)`);
  return r.recordset[0];
}

async function touchLogin(id) {
  const pool = await getPool();
  await pool.request().input("id", sql.Int, id).query("UPDATE Users SET lastLoginAt=GETDATE() WHERE userId=@id");
}

async function findStudentByCode(code) {
  const pool = await getPool();
  const r = await pool.request().input("code", sql.VarChar(20), code).query(
    "SELECT studentId, name FROM Students WHERE studentCode=@code");
  return r.recordset[0] || null;
}

async function studentHasAccount(studentId) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, studentId).query("SELECT 1 AS x FROM Users WHERE studentId=@id");
  return r.recordset.length > 0;
}

async function centreExists(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id).query("SELECT 1 AS x FROM Centres WHERE centreId=@id");
  return r.recordset.length > 0;
}

async function listCentres() {
  const pool = await getPool();
  return (await pool.request().query("SELECT centreId, name FROM Centres ORDER BY centreId")).recordset;
}

module.exports = { findByEmail, findById, createUser, touchLogin, findStudentByCode, studentHasAccount, centreExists, listCentres };

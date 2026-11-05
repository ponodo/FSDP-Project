// Usage: node backend/scripts/seedAdmin.js "Mei Lin" mei.lin@aikido.test "YourPassword1"
require("dotenv").config();
const bcrypt = require("bcrypt");
const sql = require("mssql");
const { getPool } = require("../dbConfig");

(async () => {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.log('Usage: node backend/scripts/seedAdmin.js "Full Name" email password');
    process.exit(1);
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.log("Password needs at least 8 characters, including a letter and a number.");
    process.exit(1);
  }
  const pool = await getPool();
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.request()
    .input("name", sql.VarChar(80), name).input("email", sql.VarChar(120), email.toLowerCase())
    .input("hash", sql.VarChar(100), hash)
    .query(`IF EXISTS (SELECT 1 FROM Users WHERE email=@email)
              UPDATE Users SET passwordHash=@hash, fullName=@name, role='Admin' WHERE email=@email
            ELSE
              INSERT INTO Users(fullName,email,passwordHash,role) VALUES (@name,@email,@hash,'Admin')`);
  console.log(`Admin ready: ${email.toLowerCase()}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

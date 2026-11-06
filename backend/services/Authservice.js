const bcrypt = require("bcrypt");
const model = require("../models/Authmodel");

const fail = (message, field, status = 400) => Object.assign(new Error(message), { status, field });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// hash used when the email doesn't exist, so "no such user" takes as long as "wrong password"
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-1", 12);

// simple in-memory brute-force limiter: 5 bad attempts per email+IP per 15 minutes
const attempts = new Map();
const WINDOW = 15 * 60 * 1000, MAX = 5;
function checkLimit(key) {
  const a = attempts.get(key);
  if (a && Date.now() - a.first > WINDOW) attempts.delete(key);
  const cur = attempts.get(key);
  if (cur && cur.count >= MAX) throw fail("Too many failed attempts. Try again in 15 minutes.", null, 429);
}
function recordFail(key) {
  const cur = attempts.get(key);
  if (!cur || Date.now() - cur.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else cur.count++;
}

async function register(b) {
  const fullName = String(b.fullName || "").replace(/\s+/g, " ").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  const memberId = String(b.memberId || "").trim().toUpperCase();
  const centreId = /^\d+$/.test(String(b.centreId || "")) ? parseInt(b.centreId, 10) : null;

  if (fullName.length < 2 || fullName.length > 80) throw fail("Enter your full name", "fullName");
  if (!EMAIL.test(email) || email.length > 120) throw fail("Enter a valid email address", "email");
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw fail("Use at least 8 characters, including a letter and a number", "password");
  if (password.length > 72) throw fail("Password is too long (max 72 characters)", "password"); // bcrypt limit
  if (password !== String(b.confirmPassword || "")) throw fail("Passwords don't match", "confirmPassword");
  if (!centreId || !(await model.centreExists(centreId))) throw fail("Select your training centre", "centreId");
  if (b.agree !== true) throw fail("You need to agree to the Terms of use and Privacy policy", "agree");

  let studentId = null;
  if (memberId) {
    if (!/^[A-Z0-9-]{3,20}$/.test(memberId)) throw fail("That member ID doesn't look right", "memberId");
    const s = await model.findStudentByCode(memberId);
    // name must match, otherwise anyone could claim someone else's ID and see their invoices
    if (!s || norm(s.name) !== norm(fullName))
      throw fail("We couldn't match that ID to your name. Check both, or leave the ID blank.", "memberId");
    if (await model.studentHasAccount(s.studentId)) throw fail("That member ID already has an account", "memberId", 409);
    studentId = s.studentId;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    return await model.createUser({ fullName, email, passwordHash, centreId, studentId });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) throw fail("An account with this email already exists", "email", 409);
    throw e;
  }
}

async function login(b, ip) {
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) throw fail("Enter your email and password");
  const key = ip + "|" + email;
  checkLimit(key);
  const user = await model.findByEmail(email);
  const ok = await bcrypt.compare(password.slice(0, 72), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    recordFail(key);
    throw fail("Incorrect email or password", null, 401);
  }
  attempts.delete(key);
  await model.touchLogin(user.userId);
  return user;
}

async function me(userId) {
  const u = await model.findById(userId);
  if (!u) throw fail("Account not found", null, 401);
  return u;
}

const centres = () => model.listCentres();

module.exports = { register, login, me, centres };

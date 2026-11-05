const jwt = require("jsonwebtoken");

const COOKIE = "aikido_session";

function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)
    throw new Error("Set JWT_SECRET in your .env (at least 16 random characters)");
  return process.env.JWT_SECRET;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

const cookieOptions = (remember) => ({
  httpOnly: true,                       // JS on the page can't read it
  sameSite: "lax",                      // not sent on cross-site POSTs
  secure: process.env.NODE_ENV === "production",
  path: "/",
  ...(remember ? { maxAge: 30 * 24 * 3600 * 1000 } : {}),
});

function sign(user, remember) {
  return jwt.sign({ sub: user.userId, role: user.role, name: user.fullName }, secret(), {
    expiresIn: remember ? "30d" : "12h",
  });
}

function requireAuth(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return res.status(401).json({ error: "Please sign in" });
  try {
    const p = jwt.verify(token, secret());
    req.user = { userId: p.sub, role: p.role, name: p.name };
    next();
  } catch (e) {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "Admin") return res.status(403).json({ error: "Administrators only" });
    next();
  });
}

module.exports = { COOKIE, cookieOptions, sign, requireAuth, requireAdmin };

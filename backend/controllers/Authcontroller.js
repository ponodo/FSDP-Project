// const service = require("../services/Authservice");
const service = require("./Authservice");
// const { COOKIE, cookieOptions, sign } = require("../middlewares/Auth");
const { COOKIE, cookieOptions, sign } = require("./Auth");

const pub = (u) => ({ userId: u.userId, fullName: u.fullName, role: u.role, centreId: u.centreId ?? null });
const redirectFor = (role) => (role === "Admin" ? "index.html" : "portal.html");

exports.centres = async (req, res) => res.json(await service.centres());

exports.register = async (req, res) => {
  const u = await service.register(req.body || {});
  res.cookie(COOKIE, sign(u, false), cookieOptions(false));
  res.status(201).json({ user: pub(u), redirect: redirectFor(u.role) });
};

exports.login = async (req, res) => {
  const body = req.body || {};
  const u = await service.login(body, req.ip);
  const remember = body.remember === true;
  res.cookie(COOKIE, sign(u, remember), cookieOptions(remember));
  res.json({ user: pub(u), redirect: redirectFor(u.role) });
};

exports.logout = (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
};

exports.me = async (req, res) => res.json(pub(await service.me(req.user.userId)));

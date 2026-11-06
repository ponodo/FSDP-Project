const service = require("../services/Overviewservice");

exports.overview = async (req, res) => res.json(await service.overview(req.query));
exports.portal = async (req, res) => {
  const p = await service.portal(req.user);
  if (!p) return res.status(404).json({ error: "Account not found" });
  res.json(p);
};

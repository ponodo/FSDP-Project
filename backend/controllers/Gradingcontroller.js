const service = require("../services/Gradingservice");

exports.options = async (req, res) => res.json(await service.getOptions());
exports.listSessions = async (req, res) =>
  res.json(await service.listSessions(req.query));
exports.getSession = async (req, res) =>
  res.json(await service.getSession(req.params.id));
exports.pendingSummary = async (req, res) =>
  res.json(await service.pendingSummary());
const service = require("../services/Gradingservice");

// sessions (screen 06)
exports.options = async (req, res) => res.json(await service.getOptions());
exports.listSessions = async (req, res) =>
  res.json(await service.listSessions(req.query));
exports.getSession = async (req, res) =>
  res.json(await service.getSession(req.params.id));
exports.pendingSummary = async (req, res) =>
  res.json(await service.pendingSummary());

// results & promotions (screen 08)
exports.resultSessions = async (req, res) =>
  res.json(await service.resultSessions());
exports.listResults = async (req, res) =>
  res.json(await service.listResults(req.query));
exports.getResult = async (req, res) =>
  res.json(await service.getResult(req.params.id));
exports.updateResult = async (req, res) =>
  res.json(await service.updateResult(req.params.id, req.body));
exports.emailPreview = async (req, res) =>
  res.json(await service.emailPreview(req.params.id));
exports.publishResults = async (req, res) =>
  res.json(await service.publishResults(req.body));

// notifications
exports.listNotifications = async (req, res) =>
  res.json(await service.listNotifications(req.query));
exports.resendNotification = async (req, res) =>
  res.json(await service.resendNotification(req.params.id, req.body));
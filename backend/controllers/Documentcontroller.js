const service = require("../services/Documentservice");

const CURRENT_USER = "Mei Lin"; // swap for req.user.name once JWT is added

exports.list = async (req, res) => res.json(await service.list(req.query));
exports.summary = async (req, res) =>
  res.json(await service.summary(req.query));
exports.folders = async (req, res) =>
  res.json(await service.folders(req.query));
exports.createFolder = async (req, res) =>
  res.status(201).json(await service.createFolder(req.body || {}));
exports.options = async (req, res) => res.json(await service.getOptions());
exports.match = async (req, res) => res.json(await service.match(req.query));
exports.getOne = async (req, res) =>
  res.json(await service.getOne(req.params.id));
exports.save = async (req, res) =>
  res.status(201).json(await service.save(req.body, req.file, CURRENT_USER));
exports.archive = async (req, res) =>
  res.json(await service.archive(req.params.id, (req.body || {}).archived));
exports.open = async (req, res) => {
  const f = await service.getFile(req.params.id);
  res.setHeader("Content-Type", f.mime);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(f.full);
};
exports.download = async (req, res) => {
  const f = await service.getFile(req.params.id);
  res.download(f.full, f.name);
};

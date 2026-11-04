const service = require("../services/Financeservice");

exports.report = async (req, res) =>
  res.json(await service.getReport(req.query));
exports.transactions = async (req, res) =>
  res.json(await service.getTransactions(req.query));
exports.meta = async (req, res) => res.json(await service.getMeta());
exports.exportCsv = async (req, res) => {
  const { name, csv } = await service.exportCsv(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send("\uFEFF" + csv);
};

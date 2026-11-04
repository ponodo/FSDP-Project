const router = require("express").Router();
const c = require("../controllers/Financecontroller");

router.get("/meta", c.meta);
router.get("/report", c.report);
router.get("/transactions", c.transactions);
router.get("/export", c.exportCsv);

module.exports = router;

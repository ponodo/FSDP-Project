const router = require("express").Router();
const c = require("../controllers/Gradingcontroller");

// fixed paths first, then /:id
router.get("/options", c.options);
router.get("/results/pending-summary", c.pendingSummary);
router.get("/sessions", c.listSessions);
router.get("/sessions/:id", c.getSession);

module.exports = router;
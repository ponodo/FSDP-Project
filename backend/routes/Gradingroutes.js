const router = require("express").Router();
const c = require("../controllers/Gradingcontroller");
const v = require("../middlewares/Validategrading");

// fixed paths first, then /:id
router.get("/options", c.options);

// screen 06 - grading sessions
router.get("/sessions", c.listSessions);
router.get("/sessions/:id", c.getSession);

// screen 08 - results & belt promotions
router.get("/results/pending-summary", c.pendingSummary);
router.get("/results/sessions", c.resultSessions);
router.get("/results", c.listResults);
router.post("/results/publish", v.publishResults, c.publishResults);
router.get("/results/:id", c.getResult);
router.get("/results/:id/email-preview", c.emailPreview);
router.put("/results/:id", v.updateResult, c.updateResult);

// published notification status
router.get("/notifications", c.listNotifications);
router.post("/notifications/:id/resend", v.resendNotification, c.resendNotification);

module.exports = router;
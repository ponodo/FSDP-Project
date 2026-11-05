const router = require("express").Router();
// const c = require("../controllers/Overviewcontroller");
const c = require("./Overviewcontroller");
// const { requireAuth, requireAdmin } = require("../middlewares/Auth");
const { requireAuth, requireAdmin } = require("./Auth");

router.get("/overview", requireAdmin, c.overview);
router.get("/portal", requireAuth, c.portal);

module.exports = router;

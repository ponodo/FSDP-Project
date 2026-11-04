const router = require("express").Router();
const c = require("../controllers/Documentcontroller");
const upload = require("../middlewares/upload");

// fixed paths first, then /:id
router.get("/", c.list);
router.get("/summary", c.summary);
router.get("/options", c.options);
router.get("/match", c.match);
router.get("/folders", c.folders);
router.post("/folders", c.createFolder);
router.post("/", upload, c.save);
router.get("/:id", c.getOne);
router.get("/:id/open", c.open);
router.get("/:id/download", c.download);
router.patch("/:id/archive", c.archive);

module.exports = router;

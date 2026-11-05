const router = require("express").Router();
// const c = require("../controllers/Authcontroller");
const c = require("./Authcontroller");
// const { requireAuth } = require("../middlewares/Auth");
const { requireAuth } = require("./Auth");


router.get("/centres", c.centres);          // public: registration dropdown
router.post("/register", c.register);
router.post("/login", c.login);
router.post("/logout", c.logout);
router.get("/me", requireAuth, c.me);

module.exports = router;

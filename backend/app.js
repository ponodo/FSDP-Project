require("dotenv").config();
const express = require("express");
const path = require("path");
const overviewRoutes = require("./routes/overviewRoutes");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", overviewRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));

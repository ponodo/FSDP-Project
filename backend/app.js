require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// overview routes (only mounted if the file exists in your copy)
const overviewPath = path.join(__dirname, "routes", "overviewRoutes.js");
if (fs.existsSync(overviewPath)) app.use("/api", require(overviewPath));

app.use("/api/finance", require("./routes/Financeroutes"));
app.use("/api/documents", require("./routes/Documentroutes"));
// Savion
app.use("/api/grading", require("./routes/Gradingroutes"));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res
    .status(err.status || 500)
    .json({ error: err.status ? err.message : "Something went wrong" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
  require("./services/Emailworker").start(); // Savion - grading email worker
});

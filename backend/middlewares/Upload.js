const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const httpError = require("../utils/HttpError");

const dir = path.join(__dirname, "..", "uploads", "documents");
fs.mkdirSync(dir, { recursive: true });

const ALLOWED = [".pdf", ".xlsx", ".png", ".jpg", ".jpeg"];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) =>
      cb(
        null,
        crypto.randomUUID() + path.extname(file.originalname).toLowerCase(),
      ),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(httpError(400, "Only PDF, XLSX or image files are allowed")),
}).single("file");

// turns multer errors into normal 400s
module.exports = (req, res, next) =>
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE")
      return next(httpError(400, "File is over 10 MB"));
    next(err.status ? err : httpError(400, err.message));
  });
module.exports.uploadDir = dir;

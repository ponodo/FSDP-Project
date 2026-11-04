const fs = require("fs");
const path = require("path");
const model = require("../models/Documentmodel");
const httpError = require("../utils/HttpError");
const { uploadDir } = require("../middlewares/upload");

const CATEGORIES = [
  "Class schedules",
  "Grading records",
  "Payment records",
  "Centre documents",
];
const ACCESS = ["Administrators", "All staff"];
const TYPES = ["pdf", "spreadsheet", "document", "image"];
const TYPE_BY_EXT = {
  ".pdf": "pdf",
  ".xlsx": "spreadsheet",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
};
const MIME = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const int = (v) => (/^\d+$/.test(String(v ?? "")) ? parseInt(v, 10) : null);
const cleanTitle = (t) =>
  String(t || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
// "all" / empty = every centre (NULL), number = one centre, anything else = invalid
const parseCentre = (v) =>
  v === undefined || v === "" || v === "all" ? null : (int(v) ?? NaN);

async function list(q) {
  const f = {
    category: CATEGORIES.includes(q.category) ? q.category : null,
    folderId: int(q.folderId),
    centreId: int(q.centreId),
    type: TYPES.includes(q.type) ? q.type : null,
    q: String(q.q || "")
      .trim()
      .slice(0, 100),
    tab: ["all", "recent", "archived"].includes(q.tab) ? q.tab : "all",
    sort: ["updated", "name", "size"].includes(q.sort) ? q.sort : "updated",
    page: Math.max(1, int(q.page) || 1),
    pageSize: Math.min(50, Math.max(1, int(q.pageSize) || 6)),
  };
  const { items, counts } = await model.list(f);
  const total = {
    all: counts.allCount,
    recent: counts.recentCount,
    archived: counts.archivedCount,
  }[f.tab];
  return {
    items,
    total,
    page: f.page,
    pageSize: f.pageSize,
    pages: Math.max(1, Math.ceil(total / f.pageSize)),
    counts: {
      all: counts.allCount,
      recent: counts.recentCount,
      archived: counts.archivedCount,
    },
  };
}

async function summary(q) {
  const rows = await model.summary(int(q.centreId));
  return CATEGORIES.map((c) => ({
    category: c,
    count: (rows.find((r) => r.category === c) || {}).n || 0,
  }));
}

async function folders(q) {
  return model.listFolders(CATEGORIES.includes(q.category) ? q.category : null);
}

async function createFolder(body) {
  const name = String(body.name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
  if (!CATEGORIES.includes(body.category))
    throw httpError(400, "Choose a category");
  if (!name) throw httpError(400, "Folder name is required");
  if (name.length > 60) throw httpError(400, "Folder name is too long");
  if (await model.folderExists(body.category, name))
    throw httpError(409, "That folder already exists");
  return model.createFolder(body.category, name);
}

async function getOne(id) {
  const d = await model.getById(int(id));
  if (!d) throw httpError(404, "Document not found");
  return d;
}

async function getFile(id) {
  const f = await model.getStoredFile(int(id));
  if (!f) throw httpError(404, "Document not found");
  if (!f.storedName) throw httpError(404, "This record has no file attached");
  const full = path.join(uploadDir, path.basename(f.storedName)); // basename blocks path tricks
  if (!fs.existsSync(full))
    throw httpError(404, "File is missing on the server");
  return {
    full,
    name: f.name,
    mime:
      MIME[path.extname(f.storedName).toLowerCase()] ||
      "application/octet-stream",
  };
}

async function archive(id, archived) {
  if (typeof archived !== "boolean")
    throw httpError(400, "archived must be true or false");
  if (!(await model.setArchived(int(id), archived)))
    throw httpError(404, "Document not found");
  return getOne(id);
}

const getOptions = async () => ({
  categories: CATEGORIES,
  access: ACCESS,
  ...(await model.getOptions()),
});

async function match(q) {
  const title = cleanTitle(q.title);
  const centreId = parseCentre(q.centreId);
  const ext = [".pdf", ".xlsx", ".png", ".jpg", ".jpeg"].includes(
    String(q.ext).toLowerCase(),
  )
    ? q.ext.toLowerCase()
    : ".pdf";
  if (!CATEGORIES.includes(q.category) || !title || Number.isNaN(centreId))
    return { existing: null };
  return {
    existing: await model.findExisting(q.category, centreId, title + ext),
  };
}

async function save(body, file, user) {
  const discard = () => file && fs.unlink(file.path, () => {});
  try {
    if (!file) throw httpError(400, "Choose a file to upload");
    const title = cleanTitle(body.title);
    if (!title) throw httpError(400, "Document title is required");
    if (title.length > 150) throw httpError(400, "Document title is too long");
    if (!CATEGORIES.includes(body.category))
      throw httpError(400, "Choose a category");
    const centreId = parseCentre(body.centreId);
    if (Number.isNaN(centreId)) throw httpError(400, "Choose a centre");
    if (centreId && !(await model.centreExists(centreId)))
      throw httpError(400, "That centre does not exist");
    if (!ACCESS.includes(body.access))
      throw httpError(400, "Choose who can access this");

    let termId = null;
    if (body.termId) {
      termId = int(body.termId);
      if (!termId || !(await model.termExists(termId)))
        throw httpError(400, "That term does not exist");
    }

    let sessionLabel = null,
      linkedRef = null;
    if (body.sessionId) {
      const s = await model.findSession(int(body.sessionId));
      if (!s) throw httpError(400, "That grading session does not exist");
      if (centreId && s.centreId && s.centreId !== centreId)
        throw httpError(
          400,
          "That grading session belongs to a different centre",
        );
      sessionLabel = s.label;
      linkedRef = s.code;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const name = title + ext;
    const result = await model.saveDocument({
      category: body.category,
      name,
      storedName: file.filename,
      fileType: TYPE_BY_EXT[ext],
      sizeBytes: file.size,
      centreId,
      sessionLabel,
      linkedRef,
      termId,
      access: body.access,
      folderId: int(body.folderId),
      uploadedBy: user,
    });
    return { ...result, name, category: body.category };
  } catch (e) {
    discard();
    throw e;
  }
}

module.exports = {
  list,
  summary,
  folders,
  createFolder,
  getOne,
  getFile,
  archive,
  getOptions,
  match,
  save,
};

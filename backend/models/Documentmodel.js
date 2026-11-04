const sql = require("mssql");
const { getPool } = require("../dbConfig");

const GR_CODE = `'GR-' + CAST(YEAR(sessionDate) AS CHAR(4)) + '-' + FORMAT(sessionDate,'MMdd')`;
const SAME_RECORD = `d.category=@category AND d.name=@name AND ISNULL(d.centreId,0)=ISNULL(@centreId,0)`;

const COLS = `
  d.documentId, d.folderId, d.category, d.name, d.fileType, d.sizeBytes, d.centreId,
  ISNULL(c.name,'All centres') AS centreName, d.sessionLabel, d.uploadedBy,
  CONVERT(varchar(30), d.uploadedAt, 126) AS uploadedAt, CONVERT(varchar(30), d.updatedAt, 126) AS updatedAt,
  d.access, d.version, d.linkedRef, d.isArchived, t.name AS termName,
  CASE WHEN d.storedName IS NULL THEN 0 ELSE 1 END AS hasFile`;
const FROM = `FROM Documents d LEFT JOIN Centres c ON c.centreId = d.centreId LEFT JOIN Terms t ON t.termId = d.termId`;

function filters(req, f) {
  const c = [];
  if (f.category) {
    c.push("d.category=@category");
    req.input("category", sql.VarChar(40), f.category);
  }
  if (f.folderId) {
    c.push("d.folderId=@folderId");
    req.input("folderId", sql.Int, f.folderId);
  }
  if (f.centreId) {
    c.push("(d.centreId=@centreId OR d.centreId IS NULL)");
    req.input("centreId", sql.Int, f.centreId);
  }
  if (f.type) {
    c.push("d.fileType=@type");
    req.input("type", sql.VarChar(30), f.type);
  }
  if (f.q) {
    c.push(`(d.name LIKE @q ESCAPE '\\' OR d.sessionLabel LIKE @q ESCAPE '\\' OR d.linkedRef LIKE @q ESCAPE '\\'
             OR d.uploadedBy LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\')`);
    req.input(
      "q",
      sql.NVarChar(200),
      "%" + f.q.replace(/[\\%_\[]/g, (m) => "\\" + m) + "%",
    );
  }
  return c;
}

const TAB = {
  all: "d.isArchived=0",
  recent: "d.isArchived=0 AND d.updatedAt >= DATEADD(DAY,-14,GETDATE())",
  archived: "d.isArchived=1",
};
const SORT = {
  updated: "d.updatedAt DESC, d.documentId DESC",
  name: "d.name ASC",
  size: "d.sizeBytes DESC",
};

async function list(f) {
  const pool = await getPool();
  const where = (extra) =>
    "WHERE " + [...filters(extra.req, f), extra.tab].join(" AND ");

  const r1 = pool.request();
  const items = await r1
    .input("offset", sql.Int, (f.page - 1) * f.pageSize)
    .input("pageSize", sql.Int, f.pageSize)
    .query(`SELECT ${COLS} ${FROM} ${where({ req: r1, tab: TAB[f.tab] })}
            ORDER BY ${SORT[f.sort]} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`);

  const r2 = pool.request();
  const countWhere = filters(r2, f);
  const counts = await r2.query(`
    SELECT
      ISNULL(SUM(CASE WHEN d.isArchived=0 THEN 1 ELSE 0 END),0) AS allCount,
      ISNULL(SUM(CASE WHEN ${TAB.recent} THEN 1 ELSE 0 END),0) AS recentCount,
      ISNULL(SUM(CASE WHEN d.isArchived=1 THEN 1 ELSE 0 END),0) AS archivedCount
    ${FROM} ${countWhere.length ? "WHERE " + countWhere.join(" AND ") : ""}`);
  return { items: items.recordset, counts: counts.recordset[0] };
}

async function summary(centreId) {
  const pool = await getPool();
  const r = await pool.request().input("centreId", sql.Int, centreId).query(`
    SELECT d.category, COUNT(*) AS n FROM Documents d
    WHERE d.isArchived=0 AND (@centreId IS NULL OR d.centreId=@centreId OR d.centreId IS NULL)
    GROUP BY d.category`);
  return r.recordset;
}

async function listFolders(category) {
  const pool = await getPool();
  const r = await pool.request().input("category", sql.VarChar(40), category)
    .query(`
    SELECT f.folderId, f.category, f.name,
      (SELECT COUNT(*) FROM Documents d WHERE d.folderId=f.folderId AND d.isArchived=0) AS fileCount
    FROM DocumentFolders f WHERE (@category IS NULL OR f.category=@category) ORDER BY f.name DESC`);
  return r.recordset;
}

async function folderExists(category, name) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("category", sql.VarChar(40), category)
    .input("name", sql.VarChar(100), name)
    .query(
      "SELECT folderId FROM DocumentFolders WHERE category=@category AND name=@name",
    );
  return r.recordset[0] || null;
}

async function createFolder(category, name) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("category", sql.VarChar(40), category)
    .input("name", sql.VarChar(100), name)
    .query(
      "INSERT INTO DocumentFolders(category,name) OUTPUT INSERTED.folderId, INSERTED.category, INSERTED.name VALUES (@category,@name)",
    );
  return r.recordset[0];
}

async function getById(id) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, id).query(`
    SELECT ${COLS}, f.name AS folderName,
      (SELECT COUNT(*) FROM Documents o WHERE o.category=d.category AND o.name=d.name
         AND ISNULL(o.centreId,0)=ISNULL(d.centreId,0) AND o.version < d.version) AS previousVersions
    ${FROM} LEFT JOIN DocumentFolders f ON f.folderId = d.folderId WHERE d.documentId=@id`);
  return r.recordset[0] || null;
}

async function getStoredFile(id) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(
      "SELECT name, storedName, fileType FROM Documents WHERE documentId=@id",
    );
  return r.recordset[0] || null;
}

async function setArchived(id, archived) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .input("a", sql.Bit, archived)
    .query(
      "UPDATE Documents SET isArchived=@a, updatedAt=GETDATE() WHERE documentId=@id",
    );
  return r.rowsAffected[0] > 0;
}

/* ---- upload page helpers ---- */
async function getOptions() {
  const pool = await getPool();
  const centres = await pool
    .request()
    .query("SELECT centreId, name FROM Centres ORDER BY centreId");
  const terms = await pool
    .request()
    .query(
      "SELECT termId, name, CONVERT(varchar(10),startDate,23) AS startDate FROM Terms ORDER BY startDate DESC",
    );
  const sessions = await pool.request().query(`
    SELECT sessionId, centreId, title, CONVERT(varchar(10),sessionDate,23) AS sessionDate, ${GR_CODE} AS code
    FROM GradingSessions ORDER BY sessionDate DESC`);
  return {
    centres: centres.recordset,
    terms: terms.recordset,
    sessions: sessions.recordset,
  };
}

async function findExisting(category, centreId, name) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("category", sql.VarChar(40), category)
    .input("centreId", sql.Int, centreId)
    .input("name", sql.VarChar(200), name)
    .query(`SELECT TOP 1 d.documentId, d.name, d.version, d.uploadedBy, d.linkedRef, d.sessionLabel,
              CONVERT(varchar(30), d.updatedAt, 126) AS updatedAt, ISNULL(c.name,'All centres') AS centreName
            FROM Documents d LEFT JOIN Centres c ON c.centreId=d.centreId
            WHERE ${SAME_RECORD} AND d.isArchived=0 ORDER BY d.version DESC`);
  return r.recordset[0] || null;
}

async function findSession(sessionId) {
  const pool = await getPool();
  const r = await pool.request().input("id", sql.Int, sessionId).query(`
    SELECT sessionId, centreId, ${GR_CODE} AS code, FORMAT(sessionDate,'d MMM yyyy','en-GB') AS label
    FROM GradingSessions WHERE sessionId=@id`);
  return r.recordset[0] || null;
}

async function termExists(termId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, termId)
    .query("SELECT 1 AS ok FROM Terms WHERE termId=@id");
  return r.recordset.length > 0;
}

async function centreExists(centreId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, centreId)
    .query("SELECT 1 AS ok FROM Centres WHERE centreId=@id");
  return r.recordset.length > 0;
}

// New document, or a new version of an existing record (old version is kept, moved to Archived)
async function saveDocument(d) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const q = () => new sql.Request(tx);
    const prevRes = await q()
      .input("category", sql.VarChar(40), d.category)
      .input("centreId", sql.Int, d.centreId)
      .input("name", sql.VarChar(200), d.name)
      .query(`SELECT TOP 1 documentId, version, folderId, linkedRef FROM Documents d WITH (UPDLOCK, HOLDLOCK)
              WHERE ${SAME_RECORD} AND d.isArchived=0 ORDER BY version DESC`);
    const prev = prevRes.recordset[0];

    let folderId = d.folderId || (prev && prev.folderId) || null;
    if (!folderId) {
      const year = String(new Date().getFullYear());
      const fr = await q()
        .input("category", sql.VarChar(40), d.category)
        .input("fname", sql.VarChar(100), year)
        .query(
          "SELECT folderId FROM DocumentFolders WHERE category=@category AND name=@fname",
        );
      if (fr.recordset[0]) folderId = fr.recordset[0].folderId;
      else {
        const ins = await q()
          .input("category", sql.VarChar(40), d.category)
          .input("fname", sql.VarChar(100), year)
          .query(
            "INSERT INTO DocumentFolders(category,name) OUTPUT INSERTED.folderId VALUES (@category,@fname)",
          );
        folderId = ins.recordset[0].folderId;
      }
    }

    const version = prev ? prev.version + 1 : 1;
    const linkedRef = d.linkedRef || (prev ? prev.linkedRef : null);
    if (prev)
      await q()
        .input("id", sql.Int, prev.documentId)
        .query("UPDATE Documents SET isArchived=1 WHERE documentId=@id");

    const r = await q()
      .input("folderId", sql.Int, folderId)
      .input("category", sql.VarChar(40), d.category)
      .input("name", sql.VarChar(200), d.name)
      .input("storedName", sql.VarChar(200), d.storedName)
      .input("fileType", sql.VarChar(30), d.fileType)
      .input("sizeBytes", sql.BigInt, d.sizeBytes)
      .input("centreId", sql.Int, d.centreId)
      .input("sessionLabel", sql.VarChar(100), d.sessionLabel)
      .input("uploadedBy", sql.VarChar(80), d.uploadedBy)
      .input("access", sql.VarChar(20), d.access)
      .input("version", sql.Int, version)
      .input("linkedRef", sql.VarChar(50), linkedRef)
      .input("termId", sql.Int, d.termId)
      .query(`INSERT INTO Documents (folderId,category,name,storedName,fileType,sizeBytes,centreId,sessionLabel,uploadedBy,
                uploadedAt,updatedAt,access,version,linkedRef,isArchived,termId)
              OUTPUT INSERTED.documentId
              VALUES (@folderId,@category,@name,@storedName,@fileType,@sizeBytes,@centreId,@sessionLabel,@uploadedBy,
                GETDATE(),GETDATE(),@access,@version,@linkedRef,0,@termId)`);
    await tx.commit();
    return {
      documentId: r.recordset[0].documentId,
      version,
      previousRetained: !!prev,
      linkedRef,
    };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

module.exports = {
  list,
  summary,
  listFolders,
  folderExists,
  createFolder,
  getById,
  getStoredFile,
  setArchived,
  getOptions,
  findExisting,
  findSession,
  termExists,
  centreExists,
  saveDocument,
};

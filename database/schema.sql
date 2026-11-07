IF DB_ID('FSDP') IS NULL
BEGIN
    CREATE DATABASE FSDP;
END
GO

USE FSDP;
GO

-- Drop in foreign-key order so the script can be re-run
DROP TABLE IF EXISTS dbo.Users;
DROP TABLE IF EXISTS dbo.Payments;
DROP TABLE IF EXISTS dbo.Documents;
DROP TABLE IF EXISTS dbo.DocumentFolders;
DROP TABLE IF EXISTS dbo.EmailNotifications;
DROP TABLE IF EXISTS dbo.Promotions;
DROP TABLE IF EXISTS dbo.GradingResults;
DROP TABLE IF EXISTS dbo.GradingRegistrations;
DROP TABLE IF EXISTS dbo.Invoices;
DROP TABLE IF EXISTS dbo.Students;
DROP TABLE IF EXISTS dbo.GradingSessions;
DROP TABLE IF EXISTS dbo.BeltRanks;
DROP TABLE IF EXISTS dbo.Classes;
DROP TABLE IF EXISTS dbo.Terms;
DROP TABLE IF EXISTS dbo.Instructors;
DROP TABLE IF EXISTS dbo.Centres;
GO

CREATE TABLE Centres (centreId INT IDENTITY PRIMARY KEY, name VARCHAR(50) NOT NULL);
CREATE TABLE Instructors (instructorId INT IDENTITY PRIMARY KEY, name VARCHAR(50) NOT NULL);
CREATE TABLE Terms (termId INT IDENTITY PRIMARY KEY, name VARCHAR(30), startDate DATE, endDate DATE);
CREATE TABLE Classes (
  classId INT IDENTITY PRIMARY KEY, centreId INT, venue VARCHAR(50), title VARCHAR(80),
  instructorId INT, classDate DATE, startTime TIME, durationMin INT, capacity INT, enrolled INT
);
CREATE TABLE Invoices (
  invoiceId INT IDENTITY PRIMARY KEY, centreId INT, amount DECIMAL(10,2),
  issueDate DATE, dueDate DATE, paidDate DATE NULL,
  status VARCHAR(10) CHECK (status IN ('Paid','Unpaid','Reported'))
);
CREATE TABLE GradingSessions (
  sessionId INT IDENTITY PRIMARY KEY, centreId INT, type VARCHAR(10), title VARCHAR(80),
  sessionDate DATE, startTime TIME, endTime TIME, venue VARCHAR(50),
  leadExaminer VARCHAR(50), capacity INT, registered INT
);
CREATE TABLE GradingResults (
  resultId INT IDENTITY PRIMARY KEY, sessionId INT, studentName VARCHAR(50),
  status VARCHAR(10) CHECK (status IN ('Draft','Published'))
);

-- seed
DECLARE @today DATE = CAST(GETDATE() AS DATE);
DECLARE @som DATE = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);

INSERT INTO Centres(name) VALUES ('HQ Dojo'), ('Bishan');
INSERT INTO Instructors(name) VALUES ('Daniel Tan'), ('David Lim'), ('Sarah Wong');
INSERT INTO Terms(name, startDate, endDate)
VALUES ('Term 4, 2026', DATEADD(DAY,-30,@today), DATEADD(DAY,45,@today));

INSERT INTO Classes(centreId, venue, title, instructorId, classDate, startTime, durationMin, capacity, enrolled) VALUES
(1,'Mat A','Children Aikido',1,@today,'17:00',60,24,18),
(1,'Mat A','Adult fundamentals',2,@today,'18:30',60,28,22),
(2,'Studio 1','Mixed-level Aikido',3,@today,'19:00',60,24,16),
-- overlapping pair (same instructor, tomorrow) = scheduling conflict
(1,'Mat A','Weapons class',1,DATEADD(DAY,1,@today),'18:00',60,20,12),
(2,'Studio 1','Beginner class',1,DATEADD(DAY,1,@today),'18:30',60,20,10);

INSERT INTO Invoices(centreId, amount, issueDate, dueDate, paidDate, status) VALUES
(1,12150,@som,@today,@today,'Paid'),(1,12150,@som,@today,@today,'Paid'),
(2,12150,@som,@today,@today,'Paid'),(2,12150,@som,@today,@today,'Paid'),
(1,200,@som,@today,NULL,'Reported'),(1,200,@som,@today,NULL,'Reported'),(2,200,@som,@today,NULL,'Reported');

;WITH n AS (SELECT TOP 27 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects)
INSERT INTO Invoices(centreId, amount, issueDate, dueDate, status)
SELECT 1 + (i % 2), 200, @som,
  CASE WHEN i <= 8 THEN DATEADD(DAY,-i,@today) ELSE DATEADD(DAY,i,@today) END, 'Unpaid'
FROM n;

INSERT INTO GradingSessions(centreId, type, title, sessionDate, startTime, endTime, venue, leadExaminer, capacity, registered)
VALUES (1,'Mass','November grading',DATEADD(DAY,6,@today),'09:00','12:00','Main hall','David Lim',48,36);

INSERT INTO GradingResults(sessionId, studentName, status) VALUES
(1,'Student A','Draft'),(1,'Student B','Draft'),(1,'Student C','Draft'),(1,'Student D','Draft');
GO

-- Belt ladder. rankOrder decides which belt comes next.
-- minMonths = minimum time at the previous rank before grading for this one.
CREATE TABLE BeltRanks (
  beltId     INT IDENTITY PRIMARY KEY,
  name       VARCHAR(20) NOT NULL UNIQUE,
  colour     VARCHAR(20) NOT NULL,
  rankOrder  INT NOT NULL UNIQUE,
  minMonths  INT NOT NULL DEFAULT 0
);
 
-- Remove this table if a teammate owns Students; keep the columns grading needs.
CREATE TABLE Students (
  studentId      INT IDENTITY PRIMARY KEY,
  memberCode     VARCHAR(10) NOT NULL UNIQUE,   -- e.g. AS-0108
  name           VARCHAR(80) NOT NULL,
  email          VARCHAR(120) NOT NULL,
  centreId       INT NOT NULL REFERENCES Centres(centreId),
  currentBeltId  INT NOT NULL REFERENCES BeltRanks(beltId),
  beltSince      DATE NOT NULL                    -- used for the eligibility check
);
 
-- New columns on the existing GradingSessions table
ALTER TABLE GradingSessions ADD
  code                  VARCHAR(20) NULL,          -- e.g. GR-2026-1108
  termId                INT NULL REFERENCES Terms(termId),
  fee                   DECIMAL(10,2) NOT NULL DEFAULT 0,
  registrationCloses    DATE NULL,
  leadExaminerId        INT NULL REFERENCES Instructors(instructorId),
  supportingExaminerId  INT NULL REFERENCES Instructors(instructorId),
  sessionStatus         VARCHAR(10) NOT NULL DEFAULT 'Confirmed'
                        CHECK (sessionStatus IN ('Draft','Confirmed','Completed','Cancelled'));
 
CREATE TABLE GradingRegistrations (
  registrationId  INT IDENTITY PRIMARY KEY,
  sessionId       INT NOT NULL REFERENCES GradingSessions(sessionId),
  studentId       INT NOT NULL REFERENCES Students(studentId),
  currentBeltId   INT NOT NULL REFERENCES BeltRanks(beltId),  -- belt at time of grading
  targetBeltId    INT NOT NULL REFERENCES BeltRanks(beltId),
  registeredAt    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  UNIQUE (sessionId, studentId)
);
 
-- New columns on the existing GradingResults table
ALTER TABLE GradingResults ADD
  registrationId  INT NULL REFERENCES GradingRegistrations(registrationId),
  studentId       INT NULL REFERENCES Students(studentId),
  result          VARCHAR(10) NULL CHECK (result IN ('Pass','Reassess','Fail')),
  newBeltId       INT NULL REFERENCES BeltRanks(beltId),     -- same as current unless Pass
  feedback        VARCHAR(500) NULL,
  reviewedById    INT NULL REFERENCES Instructors(instructorId),
  reviewedAt      DATETIME2 NULL,
  publishedAt     DATETIME2 NULL;
 
-- Belt history: one row per successful promotion
CREATE TABLE Promotions (
  promotionId  INT IDENTITY PRIMARY KEY,
  studentId    INT NOT NULL REFERENCES Students(studentId),
  resultId     INT NOT NULL UNIQUE REFERENCES GradingResults(resultId),
  fromBeltId   INT NOT NULL REFERENCES BeltRanks(beltId),
  toBeltId     INT NOT NULL REFERENCES BeltRanks(beltId),
  promotedAt   DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
 
-- Email queue read by the email worker (Queued -> Delivered, or retry -> Failed)
CREATE TABLE EmailNotifications (
  notificationId  INT IDENTITY PRIMARY KEY,
  studentId       INT NOT NULL REFERENCES Students(studentId),
  resultId        INT NULL REFERENCES GradingResults(resultId),
  type            VARCHAR(20) NOT NULL DEFAULT 'Promotion',
  toEmail         VARCHAR(120) NOT NULL,
  subject         VARCHAR(200) NOT NULL,
  body            VARCHAR(MAX) NOT NULL,
  status          VARCHAR(10) NOT NULL DEFAULT 'Queued'
                  CHECK (status IN ('Queued','Delivered','Failed')),
  attempts        INT NOT NULL DEFAULT 0,
  lastError       VARCHAR(300) NULL,
  nextRetryAt     DATETIME2 NULL,
  sentAt          DATETIME2 NULL,
  createdAt       DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
 
-- ===== GRADING SEED (illustrative sample data, matches the Figma) =====
DECLARE @today DATE = CAST(GETDATE() AS DATE);
 
-- beltId 1..9 = rankOrder 1..9
INSERT INTO BeltRanks(name, colour, rankOrder, minMonths) VALUES
('6th Kyu','Yellow',1,0), ('5th Kyu','Orange',2,3), ('4th Kyu','Green',3,3),
('3rd Kyu','Blue',4,4),   ('2nd Kyu','Brown',5,6),  ('1st Kyu','Brown',6,6),
('1st Dan','Black',7,12), ('2nd Dan','Black',8,24), ('3rd Dan','Black',9,36);
 
-- studentId 1..7 (named students from the Figma)
INSERT INTO Students(memberCode, name, email, centreId, currentBeltId, beltSince) VALUES
('AS-0108','Alyssa Tan','alyssa.tan@example.com',1,2,DATEADD(MONTH,-5,@today)),
('AS-0126','Marcus Ng','marcus.ng@example.com',1,3,DATEADD(MONTH,-6,@today)),
('AS-0174','Chloe Goh','chloe.goh@example.com',2,1,DATEADD(MONTH,-4,@today)),
('AS-0203','Ryan Koh','ryan.koh@example.com',1,2,DATEADD(MONTH,-4,@today)),
('AS-0141','Ethan Lee','ethan.lee@example.com',1,3,DATEADD(DAY,-10,@today)),   -- already promoted
('AS-0152','Sofia Ong','sofia.ong@example.com',2,2,DATEADD(DAY,-10,@today)),   -- already promoted
('AS-0119','Isaac Tan','isaac.tan@invalid',1,4,DATEADD(DAY,-10,@today));       -- bad email = failed send
 
-- studentId 8..43 (36 filler students = the 36 registered for the November grading)
;WITH n AS (SELECT TOP 36 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects)
INSERT INTO Students(memberCode, name, email, centreId, currentBeltId, beltSince)
SELECT CONCAT('AS-', 1000 + i), CONCAT('Sample Student ', RIGHT(CONCAT('0', i), 2)),
       CONCAT('student', i, '@example.com'), 1 + (i % 2), 1 + (i % 5),
       DATEADD(MONTH, -(3 + i % 6), @today)
FROM n;
 
-- Fill only the NEW columns of the existing November grading (sessionId 1)
UPDATE GradingSessions
SET code = CONCAT('GR-', FORMAT(sessionDate,'yyyy-MMdd')), termId = 1, fee = 20,
    registrationCloses = DATEADD(DAY,-4,sessionDate),
    leadExaminerId = 2, supportingExaminerId = 1, sessionStatus = 'Confirmed'
WHERE sessionId = 1;
 
-- sessionId 2..5
INSERT INTO GradingSessions(centreId, type, title, sessionDate, startTime, endTime, venue, leadExaminer, capacity, registered,
                            code, termId, fee, registrationCloses, leadExaminerId, supportingExaminerId, sessionStatus) VALUES
(2,'Private','Private grading - Alyssa Tan',DATEADD(DAY,9,@today),'14:00','14:45','Studio 1','Sarah Wong',1,1,
  CONCAT('GR-', FORMAT(DATEADD(DAY,9,@today),'yyyy-MMdd')),1,60,NULL,3,NULL,'Confirmed'),
(2,'Mass','Children''s mass grading',DATEADD(DAY,17,@today),'10:00','12:00','Hall A','Daniel Tan',30,24,
  CONCAT('GR-', FORMAT(DATEADD(DAY,17,@today),'yyyy-MMdd')),1,20,DATEADD(DAY,12,@today),1,3,'Confirmed'),
(1,'Private','Private grading - Marcus Ng',DATEADD(DAY,23,@today),'11:00','11:45','Mat B','David Lim',1,1,
  CONCAT('GR-', FORMAT(DATEADD(DAY,23,@today),'yyyy-MMdd')),1,60,NULL,2,NULL,'Confirmed'),
(1,'Mass','October HQ mass grading',DATEADD(DAY,-11,@today),'09:00','12:00','Main hall','David Lim',48,7,
  CONCAT('GR-', FORMAT(DATEADD(DAY,-11,@today),'yyyy-MMdd')),1,20,DATEADD(DAY,-15,@today),2,1,'Completed');
 
-- registrationId 1..7: the completed October session (session 5)
INSERT INTO GradingRegistrations(sessionId, studentId, currentBeltId, targetBeltId) VALUES
(5,1,2,3),(5,2,3,4),(5,3,1,2),(5,4,2,3),(5,5,2,3),(5,6,1,2),(5,7,3,4);
 
-- upcoming registrations
INSERT INTO GradingRegistrations(sessionId, studentId, currentBeltId, targetBeltId)
SELECT 1, studentId, currentBeltId, currentBeltId + 1 FROM Students WHERE studentId >= 8;              -- 36 / 48
INSERT INTO GradingRegistrations(sessionId, studentId, currentBeltId, targetBeltId)
SELECT 3, studentId, currentBeltId, currentBeltId + 1 FROM Students WHERE studentId BETWEEN 8 AND 31;  -- 24 / 30
INSERT INTO GradingRegistrations(sessionId, studentId, currentBeltId, targetBeltId) VALUES
(2,1,2,3),   -- private: Alyssa
(4,2,3,4);   -- private: Marcus
 
-- resultId 5..11 (1..4 are the existing Student A-D rows):
-- 4 waiting for review ('Draft'), 3 already published
INSERT INTO GradingResults(sessionId, studentName, status, registrationId, studentId, result, newBeltId,
                           feedback, reviewedById, reviewedAt, publishedAt) VALUES
(5,'Alyssa Tan','Draft',1,1,'Pass',3,'Clean ukemi, confident technique.',2,DATEADD(DAY,-11,SYSDATETIME()),NULL),
(5,'Marcus Ng','Draft',2,2,'Pass',4,'Strong posture and timing.',2,DATEADD(DAY,-11,SYSDATETIME()),NULL),
(5,'Chloe Goh','Draft',3,3,'Pass',2,'Good fundamentals for first grading.',2,DATEADD(DAY,-11,SYSDATETIME()),NULL),
(5,'Ryan Koh','Draft',4,4,'Reassess',2,'Work on shikko and suwari waza.',2,DATEADD(DAY,-11,SYSDATETIME()),NULL),
(5,'Ethan Lee','Published',5,5,'Pass',3,NULL,2,DATEADD(DAY,-11,SYSDATETIME()),DATEADD(DAY,-10,SYSDATETIME())),
(5,'Sofia Ong','Published',6,6,'Pass',2,NULL,2,DATEADD(DAY,-11,SYSDATETIME()),DATEADD(DAY,-10,SYSDATETIME())),
(5,'Isaac Tan','Published',7,7,'Pass',4,NULL,2,DATEADD(DAY,-11,SYSDATETIME()),DATEADD(DAY,-10,SYSDATETIME()));
 
INSERT INTO Promotions(studentId, resultId, fromBeltId, toBeltId, promotedAt) VALUES
(5,9,2,3,DATEADD(DAY,-10,SYSDATETIME())),
(6,10,1,2,DATEADD(DAY,-10,SYSDATETIME())),
(7,11,3,4,DATEADD(DAY,-10,SYSDATETIME()));
 
-- one delivered, one waiting to retry, one failed (matches "Published notification status")
INSERT INTO EmailNotifications(studentId, resultId, toEmail, subject, body, status, attempts, lastError, nextRetryAt, sentAt, createdAt) VALUES
(5,9,'ethan.lee@example.com','Congratulations on your 4th Kyu!',
  'Dear Ethan, congratulations on passing your grading. Your belt level has been updated to 4th Kyu. See you on the mat, Aikido Shinjukai',
  'Delivered',1,NULL,NULL,DATEADD(DAY,-10,SYSDATETIME()),DATEADD(DAY,-10,SYSDATETIME())),
(6,10,'sofia.ong@example.com','Congratulations on your 5th Kyu!',
  'Dear Sofia, congratulations on passing your grading. Your belt level has been updated to 5th Kyu. See you on the mat, Aikido Shinjukai',
  'Queued',1,'SMTP timeout',DATEADD(MINUTE,5,SYSDATETIME()),NULL,DATEADD(DAY,-10,SYSDATETIME())),
(7,11,'isaac.tan@invalid','Congratulations on your 3rd Kyu!',
  'Dear Isaac, congratulations on passing your grading. Your belt level has been updated to 3rd Kyu. See you on the mat, Aikido Shinjukai',
  'Failed',3,'Invalid email address',NULL,NULL,DATEADD(DAY,-10,SYSDATETIME()));

GO

-- ===== SHARED TABLES (login, payments, documents) =====

-- Code uses Students.studentCode in places; keep it in sync with memberCode
ALTER TABLE Students ADD studentCode AS memberCode;

-- Extra Invoice columns used by finance reports and the student portal
ALTER TABLE Invoices ADD
  studentId  INT NULL REFERENCES Students(studentId),
  feeType    VARCHAR(40) NULL,
  invoiceNo  VARCHAR(20) NULL;
GO

CREATE TABLE Users (
  userId        INT IDENTITY PRIMARY KEY,
  fullName      VARCHAR(80)  NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE,
  passwordHash  VARCHAR(100) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'Student' CHECK (role IN ('Admin','Student')),
  centreId      INT NULL REFERENCES Centres(centreId),
  studentId     INT NULL REFERENCES Students(studentId),
  lastLoginAt   DATETIME NULL,
  createdAt     DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE Payments (
  paymentId      INT IDENTITY PRIMARY KEY,
  invoiceId      INT NOT NULL REFERENCES Invoices(invoiceId),
  amount         DECIMAL(10,2) NOT NULL,
  paymentDate    DATE NOT NULL,
  method         VARCHAR(20) NOT NULL,   -- Stripe, PayNow, WhatsApp, Email, Cash
  bankReference  VARCHAR(50) NULL,
  verifiedBy     VARCHAR(80) NULL
);

CREATE TABLE DocumentFolders (
  folderId  INT IDENTITY PRIMARY KEY,
  category  VARCHAR(40)  NOT NULL,
  name      VARCHAR(100) NOT NULL,
  UNIQUE (category, name)
);

CREATE TABLE Documents (
  documentId    INT IDENTITY PRIMARY KEY,
  folderId      INT NULL REFERENCES DocumentFolders(folderId),
  category      VARCHAR(40)  NOT NULL,
  name          VARCHAR(200) NOT NULL,
  storedName    VARCHAR(200) NULL,
  fileType      VARCHAR(30)  NULL,
  sizeBytes     BIGINT NULL,
  centreId      INT NULL REFERENCES Centres(centreId),
  termId        INT NULL REFERENCES Terms(termId),
  sessionLabel  VARCHAR(100) NULL,
  uploadedBy    VARCHAR(80)  NULL,
  uploadedAt    DATETIME NOT NULL DEFAULT GETDATE(),
  updatedAt     DATETIME NOT NULL DEFAULT GETDATE(),
  access        VARCHAR(20)  NULL,
  version       INT NOT NULL DEFAULT 1,
  linkedRef     VARCHAR(50)  NULL,
  isArchived    BIT NOT NULL DEFAULT 0
);
GO

-- Admin login:  admin@aikido.test / Admin1234
INSERT INTO Users(fullName, email, passwordHash, role, centreId) VALUES
('Admin', 'admin@aikido.test', '$2b$12$5915E4hx7IZRtkqSomajn.3QzBv93A2kHpJYRj43rOPsJe3hG95e2', 'Admin', NULL);

-- Fill the new invoice columns and record payments for the paid invoices
UPDATE Invoices SET feeType = CASE WHEN amount > 1000 THEN 'Term fees' ELSE 'Monthly fees' END,
                    invoiceNo = CONCAT('INV-', 1000 + invoiceId);
INSERT INTO Payments(invoiceId, amount, paymentDate, method, bankReference, verifiedBy)
SELECT invoiceId, amount, paidDate, 'Stripe', CONCAT('pi_', invoiceId), 'Admin'
FROM Invoices WHERE status = 'Paid';
GO

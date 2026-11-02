IF DB_ID('FSDP') IS NULL
BEGIN
    CREATE DATABASE FSDP;
END
GO

USE FSDP;
GO

IF OBJECT_ID('dbo.Centers', 'U') IS NOT NULL DROP TABLE dbo.HygieneGrades;
IF OBJECT_ID('dbo.Instructors', 'U') IS NOT NULL DROP TABLE dbo.Inspections;
IF OBJECT_ID('dbo.Terms', 'U') IS NOT NULL DROP TABLE dbo.Complaints;
IF OBJECT_ID('dbo.Classes', 'U') IS NOT NULL DROP TABLE dbo.ItemLikes;
IF OBJECT_ID('dbo.Invoices', 'U') IS NOT NULL DROP TABLE dbo.Feedback;
IF OBJECT_ID('dbo.GradingSessions', 'U') IS NOT NULL DROP TABLE dbo.Payments;
IF OBJECT_ID('dbo.GradingResults', 'U') IS NOT NULL DROP TABLE dbo.OrderItems;
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
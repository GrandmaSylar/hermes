-- A login for the field server that can do only what it needs, instead of sa.
-- Run once, as an administrator, on the core database. Replace the password, and test
-- on a copy of the database first.
USE [master];
CREATE LOGIN hermes_field WITH PASSWORD = N'CHANGE-ME-long-and-random', CHECK_POLICY = ON;
GO
USE [bankpro];   -- the core database name
CREATE USER hermes_field FOR LOGIN hermes_field;
GRANT SELECT ON dbo.FieldOfficer TO hermes_field;
GRANT SELECT ON dbo.Customer TO hermes_field;
GRANT SELECT ON dbo.SavingsAccount TO hermes_field;
GRANT SELECT, INSERT ON dbo.SavingsTransaction TO hermes_field;
IF OBJECT_ID(N'dbo.MobileTransactionRejection', N'U') IS NOT NULL
  GRANT SELECT ON dbo.MobileTransactionRejection TO hermes_field;
GO
-- No UPDATE, DELETE or access to any other table: the server only reads members and
-- adds PENDING rows; it cannot post, approve or change a balance.

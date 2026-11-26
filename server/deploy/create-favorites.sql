-- One small table for the field server: which members each field officer has marked as a favourite, so the
-- list follows the officer to any phone they sign in on. Run once by the database owner, then re-run
-- grant-registration.sql (or the GRANT below) so the field login can use it. It touches no existing table.
--
--   sqlcmd -S <server> -d <database> -i create-favorites.sql

IF OBJECT_ID(N'dbo.FieldOfficerFavorite', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldOfficerFavorite (
    FieldOfficerID int           NOT NULL,
    MemberCode     numeric(10,0) NOT NULL,
    IsActive       bit           NOT NULL CONSTRAINT DF_FieldOfficerFavorite_IsActive DEFAULT 1,
    CreatedAt      datetime2     NOT NULL CONSTRAINT DF_FieldOfficerFavorite_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt      datetime2     NULL,
    CONSTRAINT PK_FieldOfficerFavorite PRIMARY KEY (FieldOfficerID, MemberCode)
  );
END;
GO

-- Rows are switched on and off, never deleted.
GRANT SELECT, INSERT, UPDATE ON dbo.FieldOfficerFavorite TO hermes_field;
GO

-- Lets the field server register new members from the phone (member registration).
-- Run once, as an administrator, on the core database, AFTER deploy/create-db-login.sql.
-- Safe to run again. Registration switches itself on at the next server restart, once the
-- server can see these tables; until then GET /health shows registrationEnabled=false.
USE [bankpro];   -- the core database name
GO

-- Member types shown on the form
GRANT SELECT ON dbo.CustomerType TO hermes_field;
GRANT SELECT ON dbo.Branch TO hermes_field;                         -- the branch and credit union names shown on the home screen

-- The member and everything that belongs to them. Only new rows: no UPDATE, no DELETE.
-- (Customer and CustomerContact are already readable from create-db-login.sql; SELECT is
-- needed to find duplicates and to read back the new member's id.)
GRANT SELECT, INSERT ON dbo.Customer TO hermes_field;                  -- the member, saved as pending (StatusCode PND)
GRANT SELECT, INSERT ON dbo.CustomerContact TO hermes_field;           -- phone, email, contact preferences
GRANT SELECT, INSERT ON dbo.CustomerAddress TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerEmployment TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerFinancial TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerBeneficiary TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerAlertPreferences TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerGuardian TO hermes_field;
GRANT SELECT, INSERT ON dbo.CustomerCompliance TO hermes_field;        -- starts as KYC Pending, risk Low, as at the office
GO
-- A registered member stays PENDING until the office approves them, exactly as a member
-- registered at the office does. The server cannot activate, change or delete a member.

-- KYC files (passport photo, ID card, proof of address, signature, thumbprint).
-- A file is added to a member's media row after the member is saved, so these tables also
-- need UPDATE. The server only ever changes rows of a PENDING member that the same banker registered.
GRANT SELECT, INSERT, UPDATE ON dbo.CustomerMedia TO hermes_field;
GRANT SELECT, INSERT, UPDATE ON dbo.CustomerDocuments TO hermes_field;                -- back of the ID card
GRANT SELECT, INSERT ON dbo.MemberAuthorizationProfile TO hermes_field;               -- signature / thumbprint / both
GRANT SELECT, INSERT, UPDATE ON dbo.MemberAuthorizationCredential TO hermes_field;
GO

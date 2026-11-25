-- A login for the field server that can do only what it needs, instead of sa.
-- Run once, as an administrator, on the core database. Replace the password, and test
-- on a copy of the database first.
USE [master];
CREATE LOGIN hermes_field WITH PASSWORD = N'CHANGE-ME-long-and-random', CHECK_POLICY = ON;
GO
USE [bankpro];   -- the core database name
CREATE USER hermes_field FOR LOGIN hermes_field;

-- Sign-in and member list
GRANT SELECT ON dbo.FieldOfficer TO hermes_field;              -- sign in; re-checked on every request
GRANT SELECT ON dbo.Customer TO hermes_field;                  -- members of the banker's branch; name for the text message

-- Savings deposits
GRANT SELECT ON dbo.SavingsAccount TO hermes_field;            -- accounts and balances; eligibility (status, closed, dormant)
GRANT SELECT ON dbo.SavingsProduct TO hermes_field;            -- product name, active flag, MinimumDeposit / MaximumDeposit
GRANT SELECT, INSERT ON dbo.SavingsTransaction TO hermes_field;-- the PENDING deposit row; duplicate lookup; the banker's list

-- Share purchases
GRANT SELECT ON dbo.ShareHolding TO hermes_field;              -- share accounts and PaidUpValue; eligibility
GRANT SELECT ON dbo.ShareProduct TO hermes_field;              -- product name, active flag, Min/MaxPurchaseAmount
GRANT SELECT, INSERT ON dbo.ShareTransaction TO hermes_field;  -- the PENDING purchase row; duplicate lookup; the banker's list

-- "Received, pending approval" text message (only used when SMS_PENDING_ENABLED=true)
GRANT SELECT ON dbo.AppSettings TO hermes_field;               -- the core's SMS_* settings. NOTE: this table also holds the SMS
                                                               -- provider API key (SMS_ApiKey / SMS_ApiSecret), so the field
                                                               -- server's database login can read it. Leave this line out, and
                                                               -- keep SMS_PENDING_ENABLED=false, if that is not acceptable.
GRANT SELECT ON dbo.CustomerContact TO hermes_field;           -- the member's mobile number (MobileAlert, PhoneNo, ...)
GRANT SELECT ON dbo.CustomerAlertPreferences TO hermes_field;  -- the member's chosen SMS number and SMS opt-out
GRANT SELECT, INSERT ON dbo.SMSHistory TO hermes_field;        -- the core's SMS log: duplicate check and a record of every send

IF OBJECT_ID(N'dbo.MobileTransactionRejection', N'U') IS NOT NULL
  GRANT SELECT ON dbo.MobileTransactionRejection TO hermes_field;  -- why the office rejected a deposit
GO
-- No UPDATE or DELETE and no access to any other table: the server only reads members and
-- adds PENDING rows (plus text-message log rows); it cannot post, approve or change a balance.
-- sp_getapplock, which stops simultaneous duplicate deposits, needs no permission beyond
-- being a user of the database.

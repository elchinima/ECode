IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id BIGINT IDENTITY(1,1) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        contact_type VARCHAR(10) NOT NULL CHECK (contact_type IN ('email', 'phone')),
        contact_value VARCHAR(120) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT pk_users PRIMARY KEY (id),
        CONSTRAINT uq_users_contact UNIQUE (contact_type, contact_value)
    );
END;
GO

IF COL_LENGTH('dbo.users', 'user_code') IS NULL
BEGIN
    ALTER TABLE dbo.users
        ADD user_code AS RIGHT(REPLICATE('0', 7) + CAST(id AS VARCHAR(20)), 7) PERSISTED;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'uq_users_user_code'
      AND object_id = OBJECT_ID('dbo.users')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX uq_users_user_code
        ON dbo.users (user_code);
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'uq_users_contact_normalized'
      AND object_id = OBJECT_ID('dbo.users')
)
BEGIN
    DROP INDEX uq_users_contact_normalized ON dbo.users;
END;
GO

IF COL_LENGTH('dbo.users', 'contact_value_normalized') IS NOT NULL
BEGIN
    ALTER TABLE dbo.users
        DROP COLUMN contact_value_normalized;
END;
GO

ALTER TABLE dbo.users
    ADD contact_value_normalized AS (
        CAST(
            CASE
                WHEN contact_type = 'email'
                    THEN LOWER(LTRIM(RTRIM(contact_value)))
                WHEN contact_type = 'phone'
                    THEN REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(contact_value)), ' ', ''), '-', ''), '(', ''), ')', '')
                ELSE LTRIM(RTRIM(contact_value))
            END
            AS VARCHAR(120)
        )
    ) PERSISTED;
GO

CREATE UNIQUE NONCLUSTERED INDEX uq_users_contact_normalized
    ON dbo.users (contact_type, contact_value_normalized);
GO

CREATE OR ALTER TRIGGER dbo.trg_users_updated_at
ON dbo.users
AFTER UPDATE AS
BEGIN
    IF NOT UPDATE(updated_at)
    BEGIN
        UPDATE t
        SET t.updated_at = CURRENT_TIMESTAMP
        FROM dbo.users t
        INNER JOIN inserted i ON t.id = i.id;
    END
END;
GO

IF OBJECT_ID('dbo.categories', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.categories (
        id INT IDENTITY(1,1) NOT NULL,
        name VARCHAR(50) NOT NULL,
        is_system BIT NOT NULL DEFAULT 1,
        created_by_user_id BIGINT NULL,
        created_at DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT pk_categories PRIMARY KEY (id),
        CONSTRAINT ck_categories_system_owner CHECK (
            (is_system = 1 AND created_by_user_id IS NULL)
            OR
            (is_system = 0 AND created_by_user_id IS NOT NULL)
        ),
        CONSTRAINT fk_categories_created_by_user
            FOREIGN KEY (created_by_user_id)
            REFERENCES dbo.users (id)
            ON DELETE NO ACTION
    );

    CREATE UNIQUE NONCLUSTERED INDEX uq_categories_system_name
        ON dbo.categories (name)
        WHERE created_by_user_id IS NULL;

    CREATE UNIQUE NONCLUSTERED INDEX uq_categories_user_name
        ON dbo.categories (created_by_user_id, name)
        WHERE created_by_user_id IS NOT NULL;
END;
GO

IF COL_LENGTH('dbo.categories', 'created_by_user_id') IS NULL
BEGIN
    ALTER TABLE dbo.categories
        ADD created_by_user_id BIGINT NULL;
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'fk_categories_created_by_user'
      AND parent_object_id = OBJECT_ID('dbo.categories')
      AND delete_referential_action_desc = 'SET_NULL'
)
BEGIN
    ALTER TABLE dbo.categories
    DROP CONSTRAINT fk_categories_created_by_user;
END;
GO

IF OBJECT_ID('dbo.fk_categories_created_by_user', 'F') IS NULL
BEGIN
    ALTER TABLE dbo.categories
    ADD CONSTRAINT fk_categories_created_by_user
        FOREIGN KEY (created_by_user_id)
        REFERENCES dbo.users (id)
    ON DELETE NO ACTION;
END;
GO

IF OBJECT_ID('dbo.ck_categories_system_owner', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.categories
    ADD CONSTRAINT ck_categories_system_owner CHECK (
        (is_system = 1 AND created_by_user_id IS NULL)
        OR
        (is_system = 0 AND created_by_user_id IS NOT NULL)
    );
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE [type] = 'UQ'
      AND [name] = 'uq_categories_name'
      AND [parent_object_id] = OBJECT_ID('dbo.categories')
)
BEGIN
    ALTER TABLE dbo.categories DROP CONSTRAINT uq_categories_name;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'uq_categories_system_name'
      AND object_id = OBJECT_ID('dbo.categories')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX uq_categories_system_name
        ON dbo.categories (name)
        WHERE created_by_user_id IS NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'uq_categories_user_name'
      AND object_id = OBJECT_ID('dbo.categories')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX uq_categories_user_name
        ON dbo.categories (created_by_user_id, name)
        WHERE created_by_user_id IS NOT NULL;
END;
GO

IF OBJECT_ID('dbo.qr_codes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.qr_codes (
        id BIGINT IDENTITY(1,1) NOT NULL,
        uid CHAR(31) NOT NULL,
        creator_user_id BIGINT NOT NULL,

        subject_name VARCHAR(100) NULL,
        subject_email VARCHAR(120) NULL,
        subject_phone VARCHAR(30) NULL,
        category_id INT NOT NULL,
        custom_text VARCHAR(250) NULL,

        payload_text VARCHAR(255) NOT NULL,
        generated_at DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
        is_deleted BIT NOT NULL DEFAULT 0,

        CONSTRAINT pk_qr_codes PRIMARY KEY (id),
        CONSTRAINT uq_qr_codes_uid UNIQUE (uid),

        CONSTRAINT fk_qr_codes_creator
            FOREIGN KEY (creator_user_id)
            REFERENCES dbo.users (id)
            ON UPDATE CASCADE, 

        CONSTRAINT fk_qr_codes_category
            FOREIGN KEY (category_id)
            REFERENCES dbo.categories (id)
            ON UPDATE CASCADE
    );

    CREATE NONCLUSTERED INDEX idx_qr_codes_creator_date 
        ON dbo.qr_codes (creator_user_id, generated_at);
        
    CREATE NONCLUSTERED INDEX idx_qr_codes_category 
        ON dbo.qr_codes (category_id);
END;
GO

IF OBJECT_ID('dbo.ck_qr_codes_uid_format', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.qr_codes
    ADD CONSTRAINT ck_qr_codes_uid_format CHECK (
        LEN(uid) = 31
        AND uid LIKE 'EC-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'
    );
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_qr_codes_uid_creator_match
ON dbo.qr_codes
AFTER INSERT, UPDATE
AS
BEGIN
    IF EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN dbo.users u ON u.id = i.creator_user_id
        WHERE SUBSTRING(i.uid, 17, 7) <> u.user_code
    )
    BEGIN
        THROW 51001, 'UID user segment must match creator_user_id (users.user_code).', 1;
    END
END;
GO

IF OBJECT_ID('dbo.qr_scan_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.qr_scan_events (
        id BIGINT IDENTITY(1,1) NOT NULL,
        qr_code_id BIGINT NULL,
        scanned_by_user_id BIGINT NULL,

        scanned_uid CHAR(31) NULL,
        raw_content VARCHAR(MAX) NOT NULL,
        scan_source VARCHAR(20) NOT NULL DEFAULT 'camera' CHECK (scan_source IN ('camera', 'upload', 'api')),
        scanned_at DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT pk_qr_scan_events PRIMARY KEY (id),

        CONSTRAINT fk_scan_events_qr
            FOREIGN KEY (qr_code_id)
            REFERENCES dbo.qr_codes (id)
            ON UPDATE CASCADE
            ON DELETE SET NULL,

        CONSTRAINT fk_scan_events_user
            FOREIGN KEY (scanned_by_user_id)
            REFERENCES dbo.users (id)
            ON DELETE SET NULL 
    );

    CREATE NONCLUSTERED INDEX idx_scan_events_qr_date 
        ON dbo.qr_scan_events (qr_code_id, scanned_at);
        
    CREATE NONCLUSTERED INDEX idx_scan_events_user_date 
        ON dbo.qr_scan_events (scanned_by_user_id, scanned_at);
END;
GO

MERGE INTO dbo.categories AS target
USING (VALUES
  ('Employee', 1),
  ('Visitor', 1),
  ('VIP', 1),
  ('Student', 1),
  ('Partner', 1)
) AS source (name, is_system)
ON target.name = source.name
     AND target.created_by_user_id IS NULL
WHEN MATCHED THEN
    UPDATE SET is_system = source.is_system,
                         created_by_user_id = NULL
WHEN NOT MATCHED THEN
  INSERT (name, is_system)
  VALUES (source.name, source.is_system);
GO

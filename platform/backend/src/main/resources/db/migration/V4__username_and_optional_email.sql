ALTER TABLE user_accounts
    ADD COLUMN username VARCHAR(32);

-- Existing email-based accounts receive a stable collision-free username.
-- They can rename it later when account profile editing is introduced.
UPDATE user_accounts
SET username = LEFT('user_' || REPLACE(CAST(id AS VARCHAR), '-', ''), 32);

ALTER TABLE user_accounts
    ALTER COLUMN username SET NOT NULL;

ALTER TABLE user_accounts
    ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX ux_user_accounts_username_lower ON user_accounts (LOWER(username));

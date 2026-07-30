ALTER TABLE user_accounts
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'USER';

ALTER TABLE user_accounts
    ADD CONSTRAINT ck_user_accounts_role CHECK (role IN ('USER', 'ADMIN'));

CREATE INDEX ix_user_accounts_role_status ON user_accounts(role, status);

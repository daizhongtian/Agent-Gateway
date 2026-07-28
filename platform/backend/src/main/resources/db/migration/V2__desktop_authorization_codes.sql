CREATE TABLE desktop_authorization_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL,
    code_challenge VARCHAR(43) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_desktop_authorization_codes_hash ON desktop_authorization_codes(code_hash);
CREATE INDEX ix_desktop_authorization_codes_active
    ON desktop_authorization_codes(expires_at)
    WHERE consumed_at IS NULL;

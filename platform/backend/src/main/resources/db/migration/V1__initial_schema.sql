CREATE TABLE user_accounts (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_user_accounts_status CHECK (status IN ('ACTIVE', 'DISABLED', 'PENDING'))
);

CREATE UNIQUE INDEX ux_user_accounts_email_lower ON user_accounts (LOWER(email));

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    access_token_hash VARCHAR(64) NOT NULL,
    refresh_token_hash VARCHAR(64) NOT NULL,
    csrf_token_hash VARCHAR(64) NOT NULL,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent VARCHAR(512),
    ip_hash VARCHAR(64)
);

CREATE UNIQUE INDEX ux_auth_sessions_access_hash ON auth_sessions(access_token_hash);
CREATE UNIQUE INDEX ux_auth_sessions_refresh_hash ON auth_sessions(refresh_token_hash);
CREATE INDEX ix_auth_sessions_user_active ON auth_sessions(user_id, refresh_expires_at) WHERE revoked_at IS NULL;

CREATE TABLE devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    platform VARCHAR(40) NOT NULL DEFAULT 'WINDOWS',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    public_key TEXT,
    public_key_thumbprint VARCHAR(64),
    device_secret_hash VARCHAR(64),
    app_version VARCHAR(40),
    paired_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_devices_status CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED'))
);

CREATE INDEX ix_devices_user ON devices(user_id, created_at DESC);

CREATE TABLE public_hosts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    slug VARCHAR(32) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
    desired_online BOOLEAN NOT NULL DEFAULT FALSE,
    protocol_version INTEGER NOT NULL DEFAULT 1,
    assigned_relay VARCHAR(160),
    last_heartbeat_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_public_hosts_status CHECK (status IN ('OFFLINE', 'ONLINE', 'DEGRADED', 'DISABLED')),
    CONSTRAINT ck_public_hosts_protocol CHECK (protocol_version > 0)
);

CREATE UNIQUE INDEX ux_public_hosts_slug ON public_hosts(slug);
CREATE INDEX ix_public_hosts_user ON public_hosts(user_id, created_at DESC);
CREATE INDEX ix_public_hosts_device ON public_hosts(device_id);

CREATE TABLE device_pairing_codes (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_device_pairing_codes_hash ON device_pairing_codes(code_hash);
CREATE INDEX ix_device_pairing_codes_device_active ON device_pairing_codes(device_id, expires_at) WHERE used_at IS NULL;

CREATE TABLE tunnel_tokens (
    id UUID PRIMARY KEY,
    host_id UUID NOT NULL REFERENCES public_hosts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ux_tunnel_tokens_hash ON tunnel_tokens(token_hash);
CREATE INDEX ix_tunnel_tokens_host_active ON tunnel_tokens(host_id, expires_at) WHERE used_at IS NULL;

CREATE TABLE tunnel_sessions (
    id UUID PRIMARY KEY,
    host_id UUID NOT NULL REFERENCES public_hosts(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    relay_node VARCHAR(160) NOT NULL,
    connection_id VARCHAR(160) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CONNECTED',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disconnected_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT ck_tunnel_sessions_status CHECK (status IN ('CONNECTED', 'DRAINING', 'DISCONNECTED'))
);

CREATE UNIQUE INDEX ux_tunnel_sessions_connection ON tunnel_sessions(connection_id);
CREATE INDEX ix_tunnel_sessions_host_active ON tunnel_sessions(host_id, connected_at DESC) WHERE disconnected_at IS NULL;

CREATE TABLE usage_buckets (
    host_id UUID NOT NULL REFERENCES public_hosts(id) ON DELETE CASCADE,
    bucket_start DATE NOT NULL,
    request_count BIGINT NOT NULL DEFAULT 0,
    request_bytes BIGINT NOT NULL DEFAULT 0,
    response_bytes BIGINT NOT NULL DEFAULT 0,
    rejected_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (host_id, bucket_start),
    CONSTRAINT ck_usage_buckets_non_negative CHECK (
        request_count >= 0 AND request_bytes >= 0 AND response_bytes >= 0 AND rejected_count >= 0
    )
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    host_id UUID REFERENCES public_hosts(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    ip_hash VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_audit_events_outcome CHECK (outcome IN ('SUCCESS', 'FAILURE'))
);

CREATE INDEX ix_audit_events_user_time ON audit_events(user_id, created_at DESC);
CREATE INDEX ix_audit_events_host_time ON audit_events(host_id, created_at DESC);

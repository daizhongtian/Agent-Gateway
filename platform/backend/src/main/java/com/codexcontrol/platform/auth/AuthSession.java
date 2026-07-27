package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.UserAccount;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "auth_sessions")
public class AuthSession {
    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @Column(name = "access_token_hash", nullable = false, length = 64)
    private String accessTokenHash;

    @Column(name = "refresh_token_hash", nullable = false, length = 64)
    private String refreshTokenHash;

    @Column(name = "csrf_token_hash", nullable = false, length = 64)
    private String csrfTokenHash;

    @Column(name = "access_expires_at", nullable = false)
    private Instant accessExpiresAt;

    @Column(name = "refresh_expires_at", nullable = false)
    private Instant refreshExpiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "ip_hash", length = 64)
    private String ipHash;

    protected AuthSession() {
    }

    public AuthSession(
            UserAccount user,
            String accessTokenHash,
            String refreshTokenHash,
            String csrfTokenHash,
            Instant accessExpiresAt,
            Instant refreshExpiresAt,
            String userAgent,
            String ipHash
    ) {
        this.user = user;
        this.accessTokenHash = accessTokenHash;
        this.refreshTokenHash = refreshTokenHash;
        this.csrfTokenHash = csrfTokenHash;
        this.accessExpiresAt = accessExpiresAt;
        this.refreshExpiresAt = refreshExpiresAt;
        this.userAgent = userAgent;
        this.ipHash = ipHash;
    }

    @PrePersist
    void beforeCreate() {
        if (id == null) id = UUID.randomUUID();
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (lastSeenAt == null) lastSeenAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UserAccount getUser() {
        return user;
    }

    public String getCsrfTokenHash() {
        return csrfTokenHash;
    }

    public Instant getAccessExpiresAt() {
        return accessExpiresAt;
    }

    public Instant getRefreshExpiresAt() {
        return refreshExpiresAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public void rotate(
            String accessTokenHash,
            String refreshTokenHash,
            String csrfTokenHash,
            Instant accessExpiresAt,
            Instant refreshExpiresAt
    ) {
        this.accessTokenHash = accessTokenHash;
        this.refreshTokenHash = refreshTokenHash;
        this.csrfTokenHash = csrfTokenHash;
        this.accessExpiresAt = accessExpiresAt;
        this.refreshExpiresAt = refreshExpiresAt;
        this.lastSeenAt = Instant.now();
    }

    public void touch() {
        this.lastSeenAt = Instant.now();
    }

    public void revoke() {
        if (revokedAt == null) revokedAt = Instant.now();
    }

    public boolean accessActive(Instant now) {
        return revokedAt == null && accessExpiresAt.isAfter(now);
    }

    public boolean refreshActive(Instant now) {
        return revokedAt == null && refreshExpiresAt.isAfter(now);
    }
}

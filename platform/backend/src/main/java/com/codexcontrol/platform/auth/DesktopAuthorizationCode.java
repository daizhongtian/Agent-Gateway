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
@Table(name = "desktop_authorization_codes")
public class DesktopAuthorizationCode {
    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @Column(name = "code_hash", nullable = false, length = 64)
    private String codeHash;

    @Column(name = "code_challenge", nullable = false, length = 43)
    private String codeChallenge;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected DesktopAuthorizationCode() {
    }

    public DesktopAuthorizationCode(UserAccount user, String codeHash, String codeChallenge, Instant expiresAt) {
        this.user = user;
        this.codeHash = codeHash;
        this.codeChallenge = codeChallenge;
        this.expiresAt = expiresAt;
    }

    @PrePersist
    void beforeCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public UserAccount getUser() {
        return user;
    }

    public String getCodeChallenge() {
        return codeChallenge;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean active(Instant now) {
        return consumedAt == null && expiresAt.isAfter(now);
    }

    public void consume(Instant now) {
        if (consumedAt == null) consumedAt = now;
    }
}

package com.codexcontrol.platform.account;

import com.codexcontrol.platform.common.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "user_accounts")
public class UserAccount extends AbstractEntity {
    @Column(nullable = false, length = 32)
    private String username;

    @Column(length = 320)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "display_name", nullable = false, length = 80)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AccountStatus status = AccountStatus.ACTIVE;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AccountRole role = AccountRole.USER;

    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    protected UserAccount() {
    }

    public UserAccount(String username, String email, String passwordHash, String displayName) {
        this.username = username;
        this.email = email;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
    }

    /** Retained for internal fixtures and bootstrap accounts created before usernames were introduced. */
    public UserAccount(String email, String passwordHash, String displayName) {
        this(legacyUsername(email), email, passwordHash, displayName);
    }

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }

    public AccountStatus getStatus() {
        return status;
    }

    public AccountRole getRole() {
        return role;
    }

    public Instant getEmailVerifiedAt() {
        return emailVerifiedAt;
    }

    public void rename(String displayName) {
        this.displayName = displayName;
    }

    public void disable() {
        this.status = AccountStatus.DISABLED;
    }

    public void enable() {
        this.status = AccountStatus.ACTIVE;
    }

    public void promoteToAdmin() {
        this.role = AccountRole.ADMIN;
    }

    private static String legacyUsername(String email) {
        String localPart = email == null ? "user" : email.substring(0, Math.max(0, email.indexOf('@')));
        String safe = localPart.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9._-]", "-");
        if (safe.length() < 3) safe = "user-" + safe;
        return safe.substring(0, Math.min(safe.length(), 32));
    }
}

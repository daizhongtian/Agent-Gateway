package com.codexcontrol.platform.device;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.common.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;

@Entity
@Table(name = "devices")
public class Device extends AbstractEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(nullable = false, length = 40)
    private String platform;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DeviceStatus status = DeviceStatus.PENDING;

    @Column(name = "public_key", columnDefinition = "text")
    private String publicKey;

    @Column(name = "public_key_thumbprint", length = 64)
    private String publicKeyThumbprint;

    @Column(name = "device_secret_hash", length = 64)
    private String deviceSecretHash;

    @Column(name = "app_version", length = 40)
    private String appVersion;

    @Column(name = "paired_at")
    private Instant pairedAt;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected Device() {
    }

    public Device(UserAccount user, String name, String platform) {
        this.user = user;
        this.name = name;
        this.platform = platform;
    }

    public UserAccount getUser() {
        return user;
    }

    public String getName() {
        return name;
    }

    public String getPlatform() {
        return platform;
    }

    public DeviceStatus getStatus() {
        return status;
    }

    public String getAppVersion() {
        return appVersion;
    }

    public Instant getPairedAt() {
        return pairedAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public boolean matchesSecret(String rawSecret, java.util.function.BiPredicate<String, String> matcher) {
        return status == DeviceStatus.ACTIVE && matcher.test(rawSecret, deviceSecretHash);
    }

    public void heartbeat() {
        if (status == DeviceStatus.ACTIVE) lastSeenAt = Instant.now();
    }

    public void rename(String value) {
        name = value;
    }

    public void pair(String publicKey, String thumbprint, String deviceSecretHash, String appVersion) {
        this.publicKey = publicKey;
        this.publicKeyThumbprint = thumbprint;
        this.deviceSecretHash = deviceSecretHash;
        this.appVersion = appVersion;
        this.status = DeviceStatus.ACTIVE;
        this.pairedAt = Instant.now();
        this.lastSeenAt = pairedAt;
    }

    public void revoke() {
        this.status = DeviceStatus.REVOKED;
        this.deviceSecretHash = null;
    }
}

package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.host.PublicHost;
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
@Table(name = "tunnel_tokens")
public class TunnelToken {
    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "host_id", nullable = false)
    private PublicHost host;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected TunnelToken() {
    }

    public TunnelToken(PublicHost host, Device device, String tokenHash, Instant expiresAt) {
        this.host = host;
        this.device = device;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    @PrePersist
    void beforeCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public PublicHost getHost() {
        return host;
    }

    public Device getDevice() {
        return device;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean active(Instant now) {
        return usedAt == null && expiresAt.isAfter(now);
    }

    public void consume(Instant now) {
        usedAt = now;
    }
}

package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.UserAccount;
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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "audit_events")
public class AuditEvent {
    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "user_id")
    private UserAccount actor;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "device_id")
    private Device device;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "host_id")
    private PublicHost host;

    @Column(nullable = false, length = 80)
    private String action;

    @Column(nullable = false, length = 20)
    private String outcome = "SUCCESS";

    @Column(name = "ip_hash", length = 64)
    private String ipHash;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> details = new LinkedHashMap<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AuditEvent() {
    }

    AuditEvent(UserAccount actor, Device device, PublicHost host, String action, Map<String, Object> details) {
        this.actor = actor;
        this.device = device;
        this.host = host;
        this.action = action;
        this.details = new LinkedHashMap<>(details);
    }

    @PrePersist
    void beforeCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UserAccount getActor() { return actor; }
    public Device getDevice() { return device; }
    public PublicHost getHost() { return host; }
    public String getAction() { return action; }
    public String getOutcome() { return outcome; }
    public Map<String, Object> getDetails() { return Map.copyOf(details); }
    public Instant getCreatedAt() { return createdAt; }
}

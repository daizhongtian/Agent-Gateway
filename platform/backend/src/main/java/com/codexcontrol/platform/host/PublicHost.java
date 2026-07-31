package com.codexcontrol.platform.host;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.common.AbstractEntity;
import com.codexcontrol.platform.device.Device;
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
@Table(name = "public_hosts")
public class PublicHost extends AbstractEntity {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "device_id", nullable = false)
    private Device device;

    @Column(nullable = false, unique = true, length = 32)
    private String slug;

    @Column(name = "display_name", nullable = false, length = 80)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private HostStatus status = HostStatus.OFFLINE;

    @Column(name = "desired_online", nullable = false)
    private boolean desiredOnline;

    @Column(name = "protocol_version", nullable = false)
    private int protocolVersion = 1;

    @Column(name = "assigned_relay", length = 160)
    private String assignedRelay;

    @Column(name = "last_heartbeat_at")
    private Instant lastHeartbeatAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected PublicHost() {
    }

    public PublicHost(UserAccount user, Device device, String slug, String displayName) {
        this.user = user;
        this.device = device;
        this.slug = slug;
        this.displayName = displayName;
    }

    public UserAccount getUser() {
        return user;
    }

    public Device getDevice() {
        return device;
    }

    public String getSlug() {
        return slug;
    }

    public String getDisplayName() {
        return displayName;
    }

    public HostStatus getStatus() {
        return status;
    }

    public boolean isDesiredOnline() {
        return desiredOnline;
    }

    public int getProtocolVersion() {
        return protocolVersion;
    }

    public String getAssignedRelay() {
        return assignedRelay;
    }

    public Instant getLastHeartbeatAt() {
        return lastHeartbeatAt;
    }

    public void update(String displayName, boolean desiredOnline) {
        this.displayName = displayName;
        this.desiredOnline = desiredOnline;
        if (!desiredOnline && status != HostStatus.DISABLED) {
            status = HostStatus.OFFLINE;
            assignedRelay = null;
            lastHeartbeatAt = null;
        }
    }

    public void markLocalProxyOnline() {
        desiredOnline = true;
        status = HostStatus.ONLINE;
        assignedRelay = "local-platform-proxy";
        lastHeartbeatAt = Instant.now();
    }

    public void markOffline() {
        desiredOnline = false;
        if (status != HostStatus.DISABLED) status = HostStatus.OFFLINE;
        assignedRelay = null;
        lastHeartbeatAt = null;
    }

    public void markRelayOnline(String assignment) {
        if (!desiredOnline || status == HostStatus.DISABLED) return;
        status = HostStatus.ONLINE;
        assignedRelay = assignment;
        lastHeartbeatAt = Instant.now();
    }

    public void markRelayHeartbeat(String assignment) {
        if (desiredOnline && status == HostStatus.ONLINE && assignment.equals(assignedRelay)) {
            lastHeartbeatAt = Instant.now();
        }
    }

    public void markRelayOffline(String assignment) {
        if (assignment.equals(assignedRelay)) {
            if (status != HostStatus.DISABLED) status = HostStatus.OFFLINE;
            assignedRelay = null;
            lastHeartbeatAt = null;
        }
    }

    public boolean isRelayAssignmentActive(String assignment) {
        return desiredOnline
                && status == HostStatus.ONLINE
                && assignment != null
                && assignment.equals(assignedRelay)
                && device.getStatus() == com.codexcontrol.platform.device.DeviceStatus.ACTIVE;
    }

    public void disable() {
        desiredOnline = false;
        status = HostStatus.DISABLED;
        assignedRelay = null;
        lastHeartbeatAt = null;
    }

    public void enable() {
        if (status == HostStatus.DISABLED) status = HostStatus.OFFLINE;
    }
}

package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.host.PublicHost;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public final class AdminDtos {
    private AdminDtos() {
    }

    public record OverviewView(
            long totalUsers,
            long activeUsers,
            long disabledUsers,
            long activeDevices,
            long revokedDevices,
            long onlineHosts,
            long disabledHosts,
            long auditEvents
    ) {
    }

    public record PageView<T>(List<T> items, int page, int size, long totalItems, int totalPages) {
        static <T> PageView<T> from(Page<T> source) {
            return new PageView<>(source.getContent(), source.getNumber(), source.getSize(), source.getTotalElements(), source.getTotalPages());
        }
    }

    public record UserView(
            UUID id,
            String email,
            String displayName,
            String role,
            String status,
            boolean emailVerified,
            Instant createdAt
    ) {
        static UserView from(UserAccount user) {
            return new UserView(
                    user.getId(), user.getEmail(), user.getDisplayName(),
                    lower(user.getRole().name()), lower(user.getStatus().name()),
                    user.getEmailVerifiedAt() != null, user.getCreatedAt());
        }
    }

    public record DeviceView(
            UUID id,
            UUID userId,
            String userEmail,
            String name,
            String platform,
            String status,
            String appVersion,
            Instant lastSeenAt,
            Instant createdAt
    ) {
        static DeviceView from(Device device) {
            return new DeviceView(
                    device.getId(), device.getUser().getId(), device.getUser().getEmail(),
                    device.getName(), device.getPlatform(), lower(device.getStatus().name()),
                    device.getAppVersion(), device.getLastSeenAt(), device.getCreatedAt());
        }
    }

    public record HostView(
            UUID id,
            UUID userId,
            String userEmail,
            UUID deviceId,
            String displayName,
            String status,
            boolean desiredOnline,
            Instant lastHeartbeatAt,
            Instant createdAt
    ) {
        static HostView from(PublicHost host) {
            return new HostView(
                    host.getId(), host.getUser().getId(), host.getUser().getEmail(), host.getDevice().getId(),
                    host.getDisplayName(), lower(host.getStatus().name()), host.isDesiredOnline(),
                    host.getLastHeartbeatAt(), host.getCreatedAt());
        }
    }

    public record AuditView(
            UUID id,
            UUID actorId,
            String actorEmail,
            String action,
            String outcome,
            String targetType,
            String targetId,
            String reason,
            String requestId,
            Instant createdAt
    ) {
        static AuditView from(AuditEvent event) {
            Map<String, Object> details = event.getDetails();
            return new AuditView(
                    event.getId(),
                    event.getActor() == null ? null : event.getActor().getId(),
                    event.getActor() == null ? null : event.getActor().getEmail(),
                    event.getAction(), lower(event.getOutcome()),
                    text(details.get("targetType")), text(details.get("targetId")),
                    text(details.get("reason")), text(details.get("requestId")), event.getCreatedAt());
        }
    }

    public record ActionRequest(@Size(max = 500) String reason) {
    }

    private static String lower(String value) {
        return value.toLowerCase(Locale.ROOT);
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}

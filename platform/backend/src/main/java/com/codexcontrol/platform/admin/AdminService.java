package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import com.codexcontrol.platform.auth.AuthSessionRepository;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.device.DeviceRepository;
import com.codexcontrol.platform.device.DeviceService;
import com.codexcontrol.platform.device.DeviceStatus;
import com.codexcontrol.platform.host.HostService;
import com.codexcontrol.platform.host.HostStatus;
import com.codexcontrol.platform.host.PublicHost;
import com.codexcontrol.platform.host.PublicHostRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AdminService {
    private final UserAccountRepository users;
    private final AuthSessionRepository sessions;
    private final DeviceRepository devices;
    private final PublicHostRepository hosts;
    private final AuditEventRepository auditEvents;
    private final DeviceService deviceService;
    private final HostService hostService;

    public AdminService(
            UserAccountRepository users,
            AuthSessionRepository sessions,
            DeviceRepository devices,
            PublicHostRepository hosts,
            AuditEventRepository auditEvents,
            DeviceService deviceService,
            HostService hostService
    ) {
        this.users = users;
        this.sessions = sessions;
        this.devices = devices;
        this.hosts = hosts;
        this.auditEvents = auditEvents;
        this.deviceService = deviceService;
        this.hostService = hostService;
    }

    @Transactional(readOnly = true)
    public AdminDtos.OverviewView overview() {
        return new AdminDtos.OverviewView(
                users.count(), users.countByStatus(AccountStatus.ACTIVE), users.countByStatus(AccountStatus.DISABLED),
                devices.countByStatus(DeviceStatus.ACTIVE), devices.countByStatus(DeviceStatus.REVOKED),
                hosts.countByStatus(HostStatus.ONLINE), hosts.countByStatus(HostStatus.DISABLED), auditEvents.count());
    }

    @Transactional(readOnly = true)
    public AdminDtos.PageView<AdminDtos.UserView> users(int page, int size) {
        return AdminDtos.PageView.from(users.findAllByOrderByCreatedAtDesc(page(page, size)).map(AdminDtos.UserView::from));
    }

    @Transactional(readOnly = true)
    public AdminDtos.PageView<AdminDtos.DeviceView> devices(int page, int size) {
        return AdminDtos.PageView.from(devices.findAllByOrderByCreatedAtDesc(page(page, size)).map(AdminDtos.DeviceView::from));
    }

    @Transactional(readOnly = true)
    public AdminDtos.PageView<AdminDtos.HostView> hosts(int page, int size) {
        return AdminDtos.PageView.from(hosts.findAllByOrderByCreatedAtDesc(page(page, size)).map(AdminDtos.HostView::from));
    }

    @Transactional(readOnly = true)
    public AdminDtos.PageView<AdminDtos.AuditView> auditEvents(int page, int size) {
        return AdminDtos.PageView.from(auditEvents.findAllByOrderByCreatedAtDesc(page(page, size)).map(AdminDtos.AuditView::from));
    }

    @Transactional
    public AdminDtos.UserView disableUser(UUID actorId, UUID targetId, String reason, String requestId) {
        if (actorId.equals(targetId)) {
            throw new ApiException(HttpStatus.CONFLICT, "ADMIN_SELF_DISABLE_FORBIDDEN", "Administrators cannot disable their own account.");
        }
        List<UserAccount> lockedAdministrators = users.findByRoleForUpdate(AccountRole.ADMIN);
        UserAccount actor = requireUser(actorId);
        UserAccount target = requireUser(targetId);
        if (target.getRole() == AccountRole.ADMIN && target.getStatus() == AccountStatus.ACTIVE
                && lockedAdministrators.stream().filter(user -> user.getStatus() == AccountStatus.ACTIVE).count() <= 1) {
            throw new ApiException(HttpStatus.CONFLICT, "LAST_ADMIN_REQUIRED", "The last active administrator cannot be disabled.");
        }
        target.disable();
        sessions.revokeAllForUser(targetId, Instant.now());
        devices.findByUserIdOrderByCreatedAtDesc(targetId).forEach(device -> deviceService.revoke(targetId, device.getId()));
        record(actor, null, null, "ADMIN_USER_DISABLED", target("user", targetId, reason, requestId));
        return AdminDtos.UserView.from(target);
    }

    @Transactional
    public AdminDtos.UserView enableUser(UUID actorId, UUID targetId, String reason, String requestId) {
        UserAccount actor = requireUser(actorId);
        UserAccount target = requireUser(targetId);
        target.enable();
        record(actor, null, null, "ADMIN_USER_ENABLED", target("user", targetId, reason, requestId));
        return AdminDtos.UserView.from(target);
    }

    @Transactional
    public AdminDtos.DeviceView revokeDevice(UUID actorId, UUID deviceId, String reason, String requestId) {
        UserAccount actor = requireUser(actorId);
        Device device = devices.findById(deviceId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_FOUND", "The device was not found."));
        deviceService.revoke(device.getUser().getId(), deviceId);
        record(actor, device, null, "ADMIN_DEVICE_REVOKED", target("device", deviceId, reason, requestId));
        return AdminDtos.DeviceView.from(device);
    }

    @Transactional
    public AdminDtos.HostView disableHost(UUID actorId, UUID hostId, String reason, String requestId) {
        UserAccount actor = requireUser(actorId);
        PublicHost host = hosts.findById(hostId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HOST_NOT_FOUND", "The Host was not found."));
        hostService.disable(host.getUser().getId(), hostId);
        record(actor, null, host, "ADMIN_HOST_DISABLED", target("host", hostId, reason, requestId));
        return AdminDtos.HostView.from(host);
    }

    private UserAccount requireUser(UUID id) {
        return users.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "The user account was not found."));
    }

    private void record(UserAccount actor, Device device, PublicHost host, String action, Map<String, Object> details) {
        auditEvents.save(new AuditEvent(actor, device, host, action, details));
    }

    private static PageRequest page(int page, int size) {
        return PageRequest.of(Math.max(0, page), Math.max(1, Math.min(size, 100)));
    }

    private static Map<String, Object> target(String type, UUID id, String reason, String requestId) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("targetType", type);
        details.put("targetId", id.toString());
        if (reason != null && !reason.isBlank()) details.put("reason", reason.trim());
        if (requestId != null && !requestId.isBlank()) details.put("requestId", requestId);
        return details;
    }
}

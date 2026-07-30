package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.auth.PlatformPrincipal;
import com.codexcontrol.platform.common.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {
    private final AdminService adminService;

    public AdminController(AdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/overview")
    public AdminDtos.OverviewView overview() {
        return adminService.overview();
    }

    @GetMapping("/users")
    public AdminDtos.PageView<AdminDtos.UserView> users(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size
    ) {
        return adminService.users(page, size);
    }

    @PostMapping("/users/{userId}/disable")
    public AdminDtos.UserView disableUser(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody AdminDtos.ActionRequest action,
            HttpServletRequest request
    ) {
        return adminService.disableUser(principal.userId(), userId, action.reason(), requestId(request));
    }

    @PostMapping("/users/{userId}/enable")
    public AdminDtos.UserView enableUser(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody AdminDtos.ActionRequest action,
            HttpServletRequest request
    ) {
        return adminService.enableUser(principal.userId(), userId, action.reason(), requestId(request));
    }

    @GetMapping("/devices")
    public AdminDtos.PageView<AdminDtos.DeviceView> devices(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size
    ) {
        return adminService.devices(page, size);
    }

    @PostMapping("/devices/{deviceId}/revoke")
    public AdminDtos.DeviceView revokeDevice(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID deviceId,
            @Valid @RequestBody AdminDtos.ActionRequest action,
            HttpServletRequest request
    ) {
        return adminService.revokeDevice(principal.userId(), deviceId, action.reason(), requestId(request));
    }

    @GetMapping("/hosts")
    public AdminDtos.PageView<AdminDtos.HostView> hosts(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size
    ) {
        return adminService.hosts(page, size);
    }

    @PostMapping("/hosts/{hostId}/disable")
    public AdminDtos.HostView disableHost(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID hostId,
            @Valid @RequestBody AdminDtos.ActionRequest action,
            HttpServletRequest request
    ) {
        return adminService.disableHost(principal.userId(), hostId, action.reason(), requestId(request));
    }

    @GetMapping("/audit-events")
    public AdminDtos.PageView<AdminDtos.AuditView> auditEvents(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        return adminService.auditEvents(page, size);
    }

    private static String requestId(HttpServletRequest request) {
        Object value = request.getAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE);
        return value instanceof String text ? text : null;
    }
}

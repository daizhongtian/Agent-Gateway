package com.codexcontrol.platform.host;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.auth.AuthService;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.device.DeviceService;
import com.codexcontrol.platform.device.DeviceStatus;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Service
public class HostService {
    private final PublicHostRepository hostRepository;
    private final DeviceService deviceService;
    private final AuthService authService;
    private final CryptoTokens tokens;
    private final PlatformProperties properties;

    public HostService(
            PublicHostRepository hostRepository,
            DeviceService deviceService,
            AuthService authService,
            CryptoTokens tokens,
            PlatformProperties properties
    ) {
        this.hostRepository = hostRepository;
        this.deviceService = deviceService;
        this.authService = authService;
        this.tokens = tokens;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<HostDtos.HostView> list(UUID userId) {
        return hostRepository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(this::view)
                .toList();
    }

    @Transactional
    public HostDtos.HostView create(UUID userId, HostDtos.CreateHostRequest request) {
        UserAccount user = authService.lockActiveUser(userId);
        if (hostRepository.countByUserId(userId) >= properties.maxHostsPerUser()) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_LIMIT_REACHED", "Disable an existing Host before creating another one.");
        }
        Device device = deviceService.requireOwned(userId, request.deviceId());
        if (device.getStatus() == DeviceStatus.REVOKED) {
            throw new ApiException(HttpStatus.CONFLICT, "DEVICE_REVOKED", "A revoked device cannot own a Host.");
        }
        String slug;
        do {
            slug = tokens.hostSlug();
        } while (hostRepository.existsBySlug(slug));
        PublicHost host = hostRepository.save(new PublicHost(user, device, slug, request.displayName().trim()));
        return view(host);
    }

    @Transactional
    public HostDtos.HostView update(UUID userId, UUID hostId, HostDtos.UpdateHostRequest request) {
        PublicHost host = requireOwned(userId, hostId);
        if (host.getStatus() == HostStatus.DISABLED && request.desiredOnline()) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_DISABLED", "Enable the Host before requesting an online connection.");
        }
        host.update(request.displayName().trim(), request.desiredOnline());
        if (properties.localProxyEnabled()) {
            if (request.desiredOnline()) host.markLocalProxyOnline();
            else host.markOffline();
        }
        return view(host);
    }

    @Transactional
    public HostDtos.HostView disable(UUID userId, UUID hostId) {
        PublicHost host = requireOwned(userId, hostId);
        host.disable();
        return view(host);
    }

    @Transactional
    public HostDtos.HostView enable(UUID userId, UUID hostId) {
        PublicHost host = requireOwned(userId, hostId);
        if (host.getDevice().getStatus() == DeviceStatus.REVOKED) {
            throw new ApiException(HttpStatus.CONFLICT, "DEVICE_REVOKED", "The Host device has been revoked.");
        }
        host.enable();
        return view(host);
    }

    @Transactional(readOnly = true)
    public PublicHost requireOwned(UUID userId, UUID hostId) {
        return hostRepository.findByIdAndUserId(hostId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HOST_NOT_FOUND", "The Host was not found."));
    }

    @Transactional(readOnly = true)
    public PublicHost requirePublicOnline(String slug) {
        if (!properties.localProxyEnabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_PROXY_DISABLED", "The platform Host proxy is not enabled.");
        }
        PublicHost host = hostRepository.findBySlug(slug)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HOST_NOT_FOUND", "The Host was not found."));
        if (!host.isDesiredOnline() || host.getStatus() != HostStatus.ONLINE) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "HOST_OFFLINE", "The Host is offline.");
        }
        return host;
    }

    @Transactional
    public void markRelayOnline(UUID hostId, UUID deviceId, String assignment) {
        PublicHost host = requireRelayHost(hostId, deviceId);
        if (!host.isDesiredOnline() || host.getStatus() == HostStatus.DISABLED) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_NOT_REQUESTED", "The Host is not requesting an online connection.");
        }
        host.markRelayOnline(assignment);
        host.getDevice().heartbeat();
    }

    @Transactional
    public void markRelayHeartbeat(UUID hostId, UUID deviceId, String assignment) {
        PublicHost host = requireRelayHost(hostId, deviceId);
        host.markRelayHeartbeat(assignment);
        host.getDevice().heartbeat();
    }

    @Transactional
    public void markRelayOffline(UUID hostId, UUID deviceId, String assignment) {
        PublicHost host = requireRelayHost(hostId, deviceId);
        host.markRelayOffline(assignment);
    }

    @Transactional(readOnly = true)
    public boolean relayAssignmentActive(String slug, String assignment) {
        return hostRepository.findBySlug(slug)
                .map(host -> host.isRelayAssignmentActive(assignment))
                .orElse(false);
    }

    @Transactional(readOnly = true)
    public PublicHost requireRelayHost(UUID hostId, UUID deviceId) {
        PublicHost host = hostRepository.findById(hostId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HOST_NOT_FOUND", "The Host was not found."));
        if (!Objects.equals(host.getDevice().getId(), deviceId)
                || host.getDevice().getStatus() == DeviceStatus.REVOKED) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DEVICE_HOST_MISMATCH", "The device is not allowed to serve this Host.");
        }
        return host;
    }

    private HostDtos.HostView view(PublicHost host) {
        return HostDtos.HostView.from(
                host,
                properties.openAiBaseUrl(host.getSlug()),
                properties.relayEnabled() || properties.localProxyEnabled());
    }
}

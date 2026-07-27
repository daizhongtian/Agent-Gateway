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
        if (hostRepository.countByUserId(userId) >= properties.maxHostsPerUser()) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_LIMIT_REACHED", "Disable an existing Host before creating another one.");
        }
        Device device = deviceService.requireOwned(userId, request.deviceId());
        if (device.getStatus() == DeviceStatus.REVOKED) {
            throw new ApiException(HttpStatus.CONFLICT, "DEVICE_REVOKED", "A revoked device cannot own a Host.");
        }
        UserAccount user = authService.requireUser(userId);
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

    private HostDtos.HostView view(PublicHost host) {
        return HostDtos.HostView.from(host, properties.openAiBaseUrl(host.getSlug()), properties.relayEnabled());
    }
}

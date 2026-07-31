package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.device.DeviceStatus;
import com.codexcontrol.platform.host.HostService;
import com.codexcontrol.platform.host.HostStatus;
import com.codexcontrol.platform.host.PublicHost;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Service
public class TunnelTokenService {
    private final TunnelTokenRepository tokenRepository;
    private final HostService hostService;
    private final CryptoTokens tokens;
    private final PlatformProperties platformProperties;
    private final RelayProperties relayProperties;

    public TunnelTokenService(
            TunnelTokenRepository tokenRepository,
            HostService hostService,
            CryptoTokens tokens,
            PlatformProperties platformProperties,
            RelayProperties relayProperties
    ) {
        this.tokenRepository = tokenRepository;
        this.hostService = hostService;
        this.tokens = tokens;
        this.platformProperties = platformProperties;
        this.relayProperties = relayProperties;
    }

    @Transactional
    public RelayDtos.TunnelTokenResponse issue(UUID userId, RelayDtos.TunnelTokenRequest request) {
        requireConfigured();
        PublicHost host = hostService.requireOwned(userId, request.hostId());
        Device device = host.getDevice();
        if (!Objects.equals(device.getId(), request.deviceId()) || device.getStatus() != DeviceStatus.ACTIVE) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DEVICE_HOST_MISMATCH", "The device is not allowed to serve this Host.");
        }
        if (!device.matchesSecret(request.deviceSecret(), tokens::matches)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_DEVICE_CREDENTIAL", "The device credential is invalid.");
        }
        if (!host.isDesiredOnline() || host.getStatus() == HostStatus.DISABLED) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_NOT_REQUESTED", "Enable Online Host before opening a Relay connection.");
        }
        String raw = tokens.opaque("ccc_tunnel_", 32);
        Instant expiresAt = Instant.now().plus(relayProperties.tunnelTokenTtl());
        tokenRepository.save(new TunnelToken(host, device, tokens.sha256(raw), expiresAt));
        return new RelayDtos.TunnelTokenResponse(
                raw,
                platformProperties.relayUrl(),
                expiresAt,
                host.getProtocolVersion(),
                host.getId(),
                host.getSlug());
    }

    @Transactional
    public RelayDtos.Admission consume(String rawToken) {
        requireConfigured();
        Instant now = Instant.now();
        TunnelToken token = tokenRepository.findActiveForUpdate(tokens.sha256(rawToken))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_TUNNEL_TOKEN", "The Tunnel Token is invalid or expired."));
        if (!token.active(now)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TUNNEL_TOKEN_EXPIRED", "The Tunnel Token is invalid or expired.");
        }
        PublicHost host = token.getHost();
        Device device = token.getDevice();
        if (!host.isDesiredOnline() || host.getStatus() == HostStatus.DISABLED || device.getStatus() != DeviceStatus.ACTIVE) {
            throw new ApiException(HttpStatus.CONFLICT, "HOST_NOT_REQUESTED", "The Host is not accepting a Relay connection.");
        }
        token.consume(now);
        return new RelayDtos.Admission(host.getId(), device.getId(), host.getSlug(), host.getProtocolVersion());
    }

    private void requireConfigured() {
        if (!platformProperties.relayEnabled() || !relayProperties.configured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "RELAY_NOT_CONFIGURED", "The Relay is not configured.");
        }
    }
}

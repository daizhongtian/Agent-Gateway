package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.device.DeviceStatus;
import com.codexcontrol.platform.host.HostService;
import com.codexcontrol.platform.host.HostStatus;
import com.codexcontrol.platform.host.PublicHost;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TunnelTokenServiceTest {
    private static final String INTERNAL_SECRET = "s".repeat(32);
    private static final String DEVICE_SECRET = "ccc_dev_test-secret-value";
    private static final String RAW_TOKEN = "ccc_tunnel_test-token-value";

    private final TunnelTokenRepository repository = mock(TunnelTokenRepository.class);
    private final HostService hosts = mock(HostService.class);
    private final CryptoTokens tokens = mock(CryptoTokens.class);
    private final UUID userId = UUID.randomUUID();
    private final UUID hostId = UUID.randomUUID();
    private final UUID deviceId = UUID.randomUUID();
    private final Device device = mock(Device.class);
    private final PublicHost host = mock(PublicHost.class);
    private TunnelTokenService service;

    @BeforeEach
    void setUp() {
        service = service(true, INTERNAL_SECRET);
        when(hosts.requireOwned(userId, hostId)).thenReturn(host);
        when(host.getId()).thenReturn(hostId);
        when(host.getDevice()).thenReturn(device);
        when(host.getSlug()).thenReturn("host-slug");
        when(host.getProtocolVersion()).thenReturn(1);
        when(host.isDesiredOnline()).thenReturn(true);
        when(host.getStatus()).thenReturn(HostStatus.OFFLINE);
        when(device.getId()).thenReturn(deviceId);
        when(device.getStatus()).thenReturn(DeviceStatus.ACTIVE);
        when(device.matchesSecret(eq(DEVICE_SECRET), any())).thenReturn(true);
        when(tokens.opaque("ccc_tunnel_", 32)).thenReturn(RAW_TOKEN);
        when(tokens.sha256(RAW_TOKEN)).thenReturn("hashed-token");
    }

    @Test
    void issuesAHashedSingleUseTokenForTheOwnedActiveHost() {
        RelayDtos.TunnelTokenResponse response = service.issue(
                userId, new RelayDtos.TunnelTokenRequest(deviceId, hostId, DEVICE_SECRET));

        assertThat(response.token()).isEqualTo(RAW_TOKEN);
        assertThat(response.relayUrl()).isEqualTo("wss://relay.example.test/agent");
        assertThat(response.hostId()).isEqualTo(hostId);
        assertThat(response.slug()).isEqualTo("host-slug");
        assertThat(response.expiresAt()).isAfter(Instant.now());
        verify(repository).save(any(TunnelToken.class));
    }

    @Test
    void issueRejectsUnconfiguredRelayAndEveryInvalidHostCredentialState() {
        assertApiCode(() -> service(false, INTERNAL_SECRET).issue(
                userId, new RelayDtos.TunnelTokenRequest(deviceId, hostId, DEVICE_SECRET)), "RELAY_NOT_CONFIGURED");
        assertApiCode(() -> service(true, "short").issue(
                userId, new RelayDtos.TunnelTokenRequest(deviceId, hostId, DEVICE_SECRET)), "RELAY_NOT_CONFIGURED");

        when(device.getId()).thenReturn(UUID.randomUUID());
        assertIssueCode("DEVICE_HOST_MISMATCH");
        when(device.getId()).thenReturn(deviceId);
        when(device.getStatus()).thenReturn(DeviceStatus.PENDING);
        assertIssueCode("DEVICE_HOST_MISMATCH");
        when(device.getStatus()).thenReturn(DeviceStatus.ACTIVE);
        when(device.matchesSecret(eq(DEVICE_SECRET), any())).thenReturn(false);
        assertIssueCode("INVALID_DEVICE_CREDENTIAL");
        when(device.matchesSecret(eq(DEVICE_SECRET), any())).thenReturn(true);
        when(host.isDesiredOnline()).thenReturn(false);
        assertIssueCode("HOST_NOT_REQUESTED");
        when(host.isDesiredOnline()).thenReturn(true);
        when(host.getStatus()).thenReturn(HostStatus.DISABLED);
        assertIssueCode("HOST_NOT_REQUESTED");
    }

    @Test
    void consumesOneActiveTokenAndRejectsMissingExpiredOrInactiveAssignments() {
        when(repository.findActiveForUpdate("hashed-token")).thenReturn(Optional.empty());
        assertApiCode(() -> service.consume(RAW_TOKEN), "INVALID_TUNNEL_TOKEN");

        TunnelToken token = mock(TunnelToken.class);
        when(repository.findActiveForUpdate("hashed-token")).thenReturn(Optional.of(token));
        when(token.active(any())).thenReturn(false);
        assertApiCode(() -> service.consume(RAW_TOKEN), "TUNNEL_TOKEN_EXPIRED");

        when(token.active(any())).thenReturn(true);
        when(token.getHost()).thenReturn(host);
        when(token.getDevice()).thenReturn(device);
        when(host.isDesiredOnline()).thenReturn(false);
        assertApiCode(() -> service.consume(RAW_TOKEN), "HOST_NOT_REQUESTED");
        when(host.isDesiredOnline()).thenReturn(true);
        when(host.getStatus()).thenReturn(HostStatus.DISABLED);
        assertApiCode(() -> service.consume(RAW_TOKEN), "HOST_NOT_REQUESTED");
        when(host.getStatus()).thenReturn(HostStatus.OFFLINE);
        when(device.getStatus()).thenReturn(DeviceStatus.REVOKED);
        assertApiCode(() -> service.consume(RAW_TOKEN), "HOST_NOT_REQUESTED");

        when(device.getStatus()).thenReturn(DeviceStatus.ACTIVE);
        RelayDtos.Admission admission = service.consume(RAW_TOKEN);
        assertThat(admission).isEqualTo(new RelayDtos.Admission(hostId, deviceId, "host-slug", 1));
        verify(token).consume(any());
    }

    private TunnelTokenService service(boolean relayEnabled, String internalSecret) {
        PlatformProperties platform = new PlatformProperties(
                null, null, null, "wss://relay.example.test/agent", relayEnabled, false, null, false,
                null, null, null, 0, 0, 0, false);
        return new TunnelTokenService(
                repository, hosts, tokens, platform, new RelayProperties(internalSecret, Duration.ofMinutes(5)));
    }

    private void assertIssueCode(String code) {
        assertApiCode(() -> service.issue(
                userId, new RelayDtos.TunnelTokenRequest(deviceId, hostId, DEVICE_SECRET)), code);
    }

    private static void assertApiCode(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo(code);
    }
}

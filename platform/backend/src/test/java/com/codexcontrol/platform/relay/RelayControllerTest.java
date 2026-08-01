package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.auth.PlatformPrincipal;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.host.HostService;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class RelayControllerTest {
    private static final String SECRET = "s".repeat(32);
    private final TunnelTokenService tokens = mock(TunnelTokenService.class);
    private final HostService hosts = mock(HostService.class);
    private final UUID hostId = UUID.randomUUID();
    private final UUID deviceId = UUID.randomUUID();
    private final RelayDtos.PresenceRequest presence =
            new RelayDtos.PresenceRequest(hostId, deviceId, "relay-assignment-1");

    @Test
    void internalControllerAuthenticatesAndForwardsEveryRelayOperation() {
        InternalRelayController controller = controller(SECRET);
        RelayDtos.Admission admission = new RelayDtos.Admission(hostId, deviceId, "host-slug", 1);
        when(tokens.consume("t".repeat(20))).thenReturn(admission);
        when(hosts.relayAssignmentActive("host-slug", "relay-assignment-1")).thenReturn(true);

        assertThat(controller.admit(SECRET, new RelayDtos.AdmitRequest("t".repeat(20)))).isEqualTo(admission);
        controller.ready(SECRET, presence);
        controller.heartbeat(SECRET, presence);
        controller.disconnect(SECRET, presence);
        assertThat(controller.authorize(SECRET, "host-slug", "relay-assignment-1").allowed()).isTrue();

        verify(hosts).markRelayOnline(hostId, deviceId, "relay-assignment-1");
        verify(hosts).markRelayHeartbeat(hostId, deviceId, "relay-assignment-1");
        verify(hosts).markRelayOffline(hostId, deviceId, "relay-assignment-1");
    }

    @Test
    void internalControllerRejectsMissingWrongAndUnconfiguredSecrets() {
        assertAuthFailure(() -> controller(SECRET).admit(null, new RelayDtos.AdmitRequest("t".repeat(20))));
        assertAuthFailure(() -> controller(SECRET).admit("wrong", new RelayDtos.AdmitRequest("t".repeat(20))));
        assertAuthFailure(() -> controller("short").admit("short", new RelayDtos.AdmitRequest("t".repeat(20))));
    }

    @Test
    void authorizeRejectsOversizedAssignmentsBeforeHostLookup() {
        InternalRelayController controller = controller(SECRET);
        assertThat(controller.authorize(SECRET, "host-slug", "x".repeat(161)).allowed()).isFalse();
        verifyNoInteractions(hosts);
    }

    @Test
    void desktopControllerForwardsTheAuthenticatedUserId() {
        UUID userId = UUID.randomUUID();
        RelayDtos.TunnelTokenRequest request =
                new RelayDtos.TunnelTokenRequest(deviceId, hostId, "d".repeat(20));
        RelayDtos.TunnelTokenResponse response = new RelayDtos.TunnelTokenResponse(
                "t".repeat(20), "wss://relay.example.test/agent", Instant.now(), 1, hostId, "host-slug");
        when(tokens.issue(userId, request)).thenReturn(response);
        PlatformPrincipal principal = new PlatformPrincipal(
                userId, UUID.randomUUID(), "owner", "owner@example.com", "Owner", AccountRole.USER, Instant.now());

        assertThat(new DesktopTunnelController(tokens).issue(principal, request)).isEqualTo(response);
    }

    private InternalRelayController controller(String secret) {
        return new InternalRelayController(tokens, hosts, new RelayProperties(secret, null));
    }

    private static void assertAuthFailure(Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("RELAY_AUTHENTICATION_FAILED");
    }
}

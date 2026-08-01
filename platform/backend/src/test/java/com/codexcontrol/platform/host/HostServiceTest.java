package com.codexcontrol.platform.host;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.auth.AuthService;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.device.DeviceService;
import com.codexcontrol.platform.device.DeviceStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HostServiceTest {
    private final PublicHostRepository repository = mock(PublicHostRepository.class);
    private final DeviceService devices = mock(DeviceService.class);
    private final AuthService auth = mock(AuthService.class);
    private final CryptoTokens tokens = mock(CryptoTokens.class);
    private final UUID userId = UUID.randomUUID();
    private final UUID hostId = UUID.randomUUID();
    private final UUID deviceId = UUID.randomUUID();
    private PlatformProperties properties;
    private HostService service;

    @BeforeEach
    void setUp() {
        properties = properties(true, 2);
        service = new HostService(repository, devices, auth, tokens, properties);
        when(auth.lockActiveUser(userId)).thenReturn(new UserAccount("owner@example.com", "hash", "Owner"));
    }

    @Test
    void listMapsOwnedHostsToPublicViews() {
        PublicHost host = host(HostStatus.ONLINE, true);
        when(repository.findByUserIdOrderByCreatedAtDesc(userId)).thenReturn(List.of(host));

        assertThat(service.list(userId)).singleElement().satisfies(view -> {
            assertThat(view.status()).isEqualTo("online");
            assertThat(view.openAiBaseUrl()).contains("host-slug");
            assertThat(view.relayReady()).isTrue();
        });
    }

    @Test
    void createEnforcesLimitsAndRejectsRevokedDevices() {
        when(repository.countByUserId(userId)).thenReturn(2L);
        assertApiCode(() -> service.create(userId, new HostDtos.CreateHostRequest(deviceId, "Host")), "HOST_LIMIT_REACHED");

        when(repository.countByUserId(userId)).thenReturn(0L);
        Device revoked = device(DeviceStatus.REVOKED);
        when(devices.requireOwned(userId, deviceId)).thenReturn(revoked);
        assertApiCode(() -> service.create(userId, new HostDtos.CreateHostRequest(deviceId, "Host")), "DEVICE_REVOKED");
        verify(auth, times(2)).lockActiveUser(userId);
    }

    @Test
    void createRetriesSlugCollisionsAndTrimsTheDisplayName() {
        Device device = device(DeviceStatus.ACTIVE);
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        when(repository.countByUserId(userId)).thenReturn(0L);
        when(devices.requireOwned(userId, deviceId)).thenReturn(device);
        when(auth.lockActiveUser(userId)).thenReturn(user);
        when(tokens.hostSlug()).thenReturn("collision", "unique-slug");
        when(repository.existsBySlug("collision")).thenReturn(true);
        when(repository.existsBySlug("unique-slug")).thenReturn(false);
        when(repository.save(any(PublicHost.class))).thenAnswer(invocation -> invocation.getArgument(0));

        HostDtos.HostView view = service.create(userId, new HostDtos.CreateHostRequest(deviceId, "  Office Host  "));

        assertThat(view.slug()).isEqualTo("unique-slug");
        assertThat(view.displayName()).isEqualTo("Office Host");
    }

    @Test
    void updateRequiresEnableAndTracksLocalProxyState() {
        PublicHost disabled = host(HostStatus.DISABLED, false);
        when(repository.findByIdAndUserId(hostId, userId)).thenReturn(Optional.of(disabled));
        assertApiCode(() -> service.update(userId, hostId, new HostDtos.UpdateHostRequest("Host", true)), "HOST_DISABLED");

        PublicHost active = host(HostStatus.OFFLINE, false);
        when(repository.findByIdAndUserId(hostId, userId)).thenReturn(Optional.of(active));
        service.update(userId, hostId, new HostDtos.UpdateHostRequest("Host", true));
        verify(active).update("Host", true);
        verify(active).markLocalProxyOnline();

        service.update(userId, hostId, new HostDtos.UpdateHostRequest("Host", false));
        verify(active).markOffline();
    }

    @Test
    void disableAndEnableRespectDeviceRevocation() {
        PublicHost host = host(HostStatus.ONLINE, true);
        when(repository.findByIdAndUserId(hostId, userId)).thenReturn(Optional.of(host));
        service.disable(userId, hostId);
        verify(host).disable();

        when(host.getDevice().getStatus()).thenReturn(DeviceStatus.REVOKED);
        assertApiCode(() -> service.enable(userId, hostId), "DEVICE_REVOKED");
        when(host.getDevice().getStatus()).thenReturn(DeviceStatus.ACTIVE);
        service.enable(userId, hostId);
        verify(host).enable();
    }

    @Test
    void ownershipAndPublicAvailabilityFailuresHaveStableCodes() {
        when(repository.findByIdAndUserId(hostId, userId)).thenReturn(Optional.empty());
        assertApiCode(() -> service.requireOwned(userId, hostId), "HOST_NOT_FOUND");

        HostService proxyDisabled = new HostService(repository, devices, auth, tokens, properties(false, 2));
        assertApiCode(() -> proxyDisabled.requirePublicOnline("slug"), "LOCAL_PROXY_DISABLED");

        when(repository.findBySlug("missing")).thenReturn(Optional.empty());
        assertApiCode(() -> service.requirePublicOnline("missing"), "HOST_NOT_FOUND");

        PublicHost offline = host(HostStatus.OFFLINE, true);
        when(repository.findBySlug("offline")).thenReturn(Optional.of(offline));
        assertApiCode(() -> service.requirePublicOnline("offline"), "HOST_OFFLINE");

        PublicHost notDesired = host(HostStatus.ONLINE, false);
        when(repository.findBySlug("not-desired")).thenReturn(Optional.of(notDesired));
        assertApiCode(() -> service.requirePublicOnline("not-desired"), "HOST_OFFLINE");

        PublicHost online = host(HostStatus.ONLINE, true);
        when(repository.findBySlug("online")).thenReturn(Optional.of(online));
        assertThat(service.requirePublicOnline("online")).isSameAs(online);
    }

    @Test
    void relayPresenceValidatesHostDeviceAndAssignmentState() {
        PublicHost host = host(HostStatus.ONLINE, true);
        when(repository.findById(hostId)).thenReturn(Optional.of(host));

        service.markRelayOnline(hostId, deviceId, "relay-1");
        service.markRelayHeartbeat(hostId, deviceId, "relay-1");
        service.markRelayOffline(hostId, deviceId, "relay-1");
        verify(host).markRelayOnline("relay-1");
        verify(host).markRelayHeartbeat("relay-1");
        verify(host).markRelayOffline("relay-1");
        verify(host.getDevice(), times(2)).heartbeat();

        when(host.isDesiredOnline()).thenReturn(false);
        assertApiCode(() -> service.markRelayOnline(hostId, deviceId, "relay-1"), "HOST_NOT_REQUESTED");
        when(host.isDesiredOnline()).thenReturn(true);
        when(host.getStatus()).thenReturn(HostStatus.DISABLED);
        assertApiCode(() -> service.markRelayOnline(hostId, deviceId, "relay-1"), "HOST_NOT_REQUESTED");

        when(repository.findBySlug("missing-relay")).thenReturn(Optional.empty());
        assertThat(service.relayAssignmentActive("missing-relay", "relay-1")).isFalse();
        when(repository.findBySlug("active-relay")).thenReturn(Optional.of(host));
        when(host.isRelayAssignmentActive("relay-1")).thenReturn(true);
        assertThat(service.relayAssignmentActive("active-relay", "relay-1")).isTrue();
    }

    @Test
    void relayHostLookupRejectsMissingMismatchedAndRevokedDevices() {
        when(repository.findById(hostId)).thenReturn(Optional.empty());
        assertApiCode(() -> service.requireRelayHost(hostId, deviceId), "HOST_NOT_FOUND");

        PublicHost host = host(HostStatus.OFFLINE, true);
        when(repository.findById(hostId)).thenReturn(Optional.of(host));
        when(host.getDevice().getId()).thenReturn(UUID.randomUUID());
        assertApiCode(() -> service.requireRelayHost(hostId, deviceId), "DEVICE_HOST_MISMATCH");
        when(host.getDevice().getId()).thenReturn(deviceId);
        when(host.getDevice().getStatus()).thenReturn(DeviceStatus.REVOKED);
        assertApiCode(() -> service.requireRelayHost(hostId, deviceId), "DEVICE_HOST_MISMATCH");
        when(host.getDevice().getStatus()).thenReturn(DeviceStatus.ACTIVE);
        assertThat(service.requireRelayHost(hostId, deviceId)).isSameAs(host);
    }

    private PublicHost host(HostStatus status, boolean desiredOnline) {
        PublicHost host = mock(PublicHost.class);
        Device device = device(DeviceStatus.ACTIVE);
        when(host.getId()).thenReturn(hostId);
        when(host.getDevice()).thenReturn(device);
        when(host.getSlug()).thenReturn("host-slug");
        when(host.getDisplayName()).thenReturn("Office Host");
        when(host.getStatus()).thenReturn(status);
        when(host.isDesiredOnline()).thenReturn(desiredOnline);
        when(host.getProtocolVersion()).thenReturn(1);
        return host;
    }

    private Device device(DeviceStatus status) {
        Device device = mock(Device.class);
        when(device.getId()).thenReturn(deviceId);
        when(device.getName()).thenReturn("Office PC");
        when(device.getStatus()).thenReturn(status);
        return device;
    }

    private static PlatformProperties properties(boolean localProxyEnabled, int maxHosts) {
        return new PlatformProperties(
                null, null, null, null, false, localProxyEnabled, null, false,
                Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofMinutes(10), 10, 10, maxHosts, true);
    }

    private static void assertApiCode(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo(code);
    }
}

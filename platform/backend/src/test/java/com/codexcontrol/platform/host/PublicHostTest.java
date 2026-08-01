package com.codexcontrol.platform.host;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.device.Device;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PublicHostTest {
    @Test
    void hostStateTransitionsPreserveDisabledStateAndClearRelayData() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Device device = new Device(user, "Office PC", "windows");
        PublicHost host = new PublicHost(user, device, "host-slug", "Office Host");

        host.update("Renamed Host", true);
        assertThat(host.getDisplayName()).isEqualTo("Renamed Host");
        assertThat(host.isDesiredOnline()).isTrue();

        host.markLocalProxyOnline();
        assertThat(host.getStatus()).isEqualTo(HostStatus.ONLINE);
        assertThat(host.getAssignedRelay()).isEqualTo("local-platform-proxy");
        assertThat(host.getLastHeartbeatAt()).isNotNull();

        host.update("Offline Host", false);
        assertThat(host.getStatus()).isEqualTo(HostStatus.OFFLINE);
        host.markOffline();
        assertThat(host.getAssignedRelay()).isNull();

        host.disable();
        host.update("Still Disabled", false);
        host.markOffline();
        assertThat(host.getStatus()).isEqualTo(HostStatus.DISABLED);
        host.enable();
        assertThat(host.getStatus()).isEqualTo(HostStatus.OFFLINE);
        host.enable();
        assertThat(host.getStatus()).isEqualTo(HostStatus.OFFLINE);
        assertThat(host.getUser()).isSameAs(user);
        assertThat(host.getDevice()).isSameAs(device);
        assertThat(host.getProtocolVersion()).isEqualTo(1);
    }

    @Test
    void relayPresenceRequiresTheExpectedActiveDeviceAndAssignment() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Device device = new Device(user, "Office PC", "windows");
        PublicHost host = new PublicHost(user, device, "host-slug", "Office Host");

        host.markRelayOnline("relay-1");
        host.markRelayHeartbeat("relay-1");
        assertThat(host.isRelayAssignmentActive("relay-1")).isFalse();
        host.update("Office Host", true);
        host.markRelayHeartbeat("relay-1");
        assertThat(host.isRelayAssignmentActive("relay-1")).isFalse();

        device.pair("public-key", "thumbprint", "secret-hash", "3.0.9");
        host.markRelayOnline("relay-1");
        assertThat(host.isRelayAssignmentActive(null)).isFalse();
        assertThat(host.isRelayAssignmentActive("relay-2")).isFalse();
        assertThat(host.isRelayAssignmentActive("relay-1")).isTrue();
        host.markRelayHeartbeat("relay-2");
        host.markRelayHeartbeat("relay-1");
        assertThat(host.getLastHeartbeatAt()).isNotNull();

        host.markRelayOffline("relay-2");
        assertThat(host.getAssignedRelay()).isEqualTo("relay-1");
        device.revoke();
        assertThat(host.isRelayAssignmentActive("relay-1")).isFalse();
        host.markRelayOffline("relay-1");
        assertThat(host.getStatus()).isEqualTo(HostStatus.OFFLINE);

        host.disable();
        host.markRelayOnline("relay-1");
        host.markRelayOffline("relay-1");
        assertThat(host.getStatus()).isEqualTo(HostStatus.DISABLED);
    }
}

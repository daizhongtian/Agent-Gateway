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
}

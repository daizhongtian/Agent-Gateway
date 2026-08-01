package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.device.Device;
import com.codexcontrol.platform.host.PublicHost;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class TunnelTokenTest {
    @Test
    void entityInitializesOnceAndTracksSingleUseExpiry() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Device device = new Device(user, "Office PC", "windows");
        PublicHost host = new PublicHost(user, device, "host-slug", "Office Host");
        Instant expiresAt = Instant.now().plus(Duration.ofMinutes(5));
        TunnelToken token = new TunnelToken(host, device, "hashed-token", expiresAt);

        token.beforeCreate();
        token.beforeCreate();
        assertThat(token.getHost()).isSameAs(host);
        assertThat(token.getDevice()).isSameAs(device);
        assertThat(token.getExpiresAt()).isEqualTo(expiresAt);
        assertThat(token.active(Instant.now())).isTrue();
        token.consume(Instant.now());
        assertThat(token.active(Instant.now())).isFalse();

        TunnelToken expired = new TunnelToken(host, device, "expired", Instant.now().minusSeconds(1));
        assertThat(expired.active(Instant.now())).isFalse();
        assertThat(new TunnelToken().getHost()).isNull();
    }

    @Test
    void relayPropertiesNormalizeSecretsAndTokenLifetimes() {
        assertThat(new RelayProperties(null, null).configured()).isFalse();
        assertThat(new RelayProperties(" short ", Duration.ZERO).tunnelTokenTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(new RelayProperties("short", Duration.ofSeconds(-1)).tunnelTokenTtl()).isEqualTo(Duration.ofMinutes(5));
        RelayProperties configured = new RelayProperties(" " + "s".repeat(32) + " ", Duration.ofMinutes(2));
        assertThat(configured.configured()).isTrue();
        assertThat(configured.internalSecret()).hasSize(32);
        assertThat(configured.tunnelTokenTtl()).isEqualTo(Duration.ofMinutes(2));
    }
}

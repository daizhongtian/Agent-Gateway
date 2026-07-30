package com.codexcontrol.platform.device;

import com.codexcontrol.platform.account.UserAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class DevicePairingCodeTest {
    @Test
    void pairingCodeLifecycleIsIdempotentAndExpiresOrConsumesSafely() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Device device = new Device(user, "Office PC", "windows");
        Instant now = Instant.now();
        DevicePairingCode code = new DevicePairingCode(user, device, "hash", now.plusSeconds(60));

        code.beforeCreate();
        code.beforeCreate();
        assertThat(code.active(now)).isTrue();
        assertThat(code.active(now.plusSeconds(61))).isFalse();
        code.consume();
        Instant usedAt = code.getUsedAt();
        code.consume();
        assertThat(code.getUsedAt()).isAfterOrEqualTo(usedAt);
        assertThat(code.active(now)).isFalse();
        assertThat(code.getDevice()).isSameAs(device);
        assertThat(code.getExpiresAt()).isEqualTo(now.plusSeconds(60));
    }
}

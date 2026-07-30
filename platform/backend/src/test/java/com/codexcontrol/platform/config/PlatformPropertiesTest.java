package com.codexcontrol.platform.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class PlatformPropertiesTest {
    @Test
    void defaultsAreSafeAndLocalProxyUsesTheDevelopmentHostTemplate() {
        PlatformProperties properties = new PlatformProperties(
                " ", null, null, "", false, true, "http://127.0.0.1:4310/", false,
                Duration.ZERO, Duration.ofSeconds(-1), null, 0, -1, 0, true);

        assertThat(properties.frontendOrigin()).isEqualTo("http://localhost:5173");
        assertThat(properties.publicHostDomain()).isEqualTo("api.localhost");
        assertThat(properties.publicHostUrlTemplate()).isEqualTo("http://localhost:8080/h/{slug}/v1");
        assertThat(properties.relayUrl()).isEqualTo("wss://relay.localhost/agent");
        assertThat(properties.localGatewayBaseUrl()).isEqualTo("http://127.0.0.1:4310");
        assertThat(properties.accessTokenTtl()).isEqualTo(Duration.ofMinutes(15));
        assertThat(properties.refreshTokenTtl()).isEqualTo(Duration.ofDays(30));
        assertThat(properties.pairingCodeTtl()).isEqualTo(Duration.ofMinutes(10));
        assertThat(properties.maxSessionsPerUser()).isEqualTo(10);
        assertThat(properties.maxDevicesPerUser()).isEqualTo(10);
        assertThat(properties.maxHostsPerUser()).isEqualTo(10);
        assertThat(properties.openAiBaseUrl("host-1")).isEqualTo("http://localhost:8080/h/host-1/v1");
    }

    @Test
    void explicitProductionConfigurationIsTrimmedAndPreserved() {
        PlatformProperties properties = new PlatformProperties(
                " https://app.example.com ", " hosts.example.com ", " https://gateway.example.com/h/{slug}/v1 ",
                " wss://relay.example.com/agent ", true, false, " https://local.example.com/base/ ", true,
                Duration.ofMinutes(5), Duration.ofDays(7), Duration.ofMinutes(2), 3, 4, 5, false);

        assertThat(properties.frontendOrigin()).isEqualTo("https://app.example.com");
        assertThat(properties.publicHostDomain()).isEqualTo("hosts.example.com");
        assertThat(properties.openAiBaseUrl("abc")).isEqualTo("https://gateway.example.com/h/abc/v1");
        assertThat(properties.relayUrl()).isEqualTo("wss://relay.example.com/agent");
        assertThat(properties.localGatewayBaseUrl()).isEqualTo("https://local.example.com/base");
        assertThat(properties.maxSessionsPerUser()).isEqualTo(3);
        assertThat(properties.maxDevicesPerUser()).isEqualTo(4);
        assertThat(properties.maxHostsPerUser()).isEqualTo(5);
    }
}

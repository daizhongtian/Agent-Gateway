package com.codexcontrol.platform.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "platform")
public record PlatformProperties(
        String frontendOrigin,
        String publicHostDomain,
        String relayUrl,
        boolean relayEnabled,
        boolean secureCookies,
        Duration accessTokenTtl,
        Duration refreshTokenTtl,
        Duration pairingCodeTtl,
        int maxSessionsPerUser,
        int maxDevicesPerUser,
        int maxHostsPerUser
) {
    public PlatformProperties {
        frontendOrigin = valueOr(frontendOrigin, "http://localhost:5173");
        publicHostDomain = valueOr(publicHostDomain, "api.localhost");
        relayUrl = valueOr(relayUrl, "wss://relay.localhost/agent");
        accessTokenTtl = valueOr(accessTokenTtl, Duration.ofMinutes(15));
        refreshTokenTtl = valueOr(refreshTokenTtl, Duration.ofDays(30));
        pairingCodeTtl = valueOr(pairingCodeTtl, Duration.ofMinutes(10));
        maxSessionsPerUser = positiveOr(maxSessionsPerUser, 10);
        maxDevicesPerUser = positiveOr(maxDevicesPerUser, 10);
        maxHostsPerUser = positiveOr(maxHostsPerUser, 10);
    }

    public String openAiBaseUrl(String slug) {
        return "https://" + slug + "." + publicHostDomain + "/v1";
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static Duration valueOr(Duration value, Duration fallback) {
        return value == null || value.isNegative() || value.isZero() ? fallback : value;
    }

    private static int positiveOr(int value, int fallback) {
        return value > 0 ? value : fallback;
    }
}

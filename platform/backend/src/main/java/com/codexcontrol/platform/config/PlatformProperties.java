package com.codexcontrol.platform.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "platform")
public record PlatformProperties(
        String frontendOrigin,
        String publicHostDomain,
        String publicHostUrlTemplate,
        String relayUrl,
        boolean relayEnabled,
        boolean localProxyEnabled,
        String localGatewayBaseUrl,
        boolean secureCookies,
        Duration accessTokenTtl,
        Duration refreshTokenTtl,
        Duration pairingCodeTtl,
        int maxSessionsPerUser,
        int maxDevicesPerUser,
        int maxHostsPerUser,
        boolean legalConsentRequired
) {
    public PlatformProperties {
        frontendOrigin = valueOr(frontendOrigin, "http://localhost:5173");
        publicHostDomain = valueOr(publicHostDomain, "api.localhost");
        publicHostUrlTemplate = valueOr(
                publicHostUrlTemplate,
                localProxyEnabled ? "http://localhost:8080/h/{slug}/v1" : "https://{slug}." + publicHostDomain + "/v1");
        relayUrl = valueOr(relayUrl, "wss://relay.localhost/agent");
        localGatewayBaseUrl = normalizedBaseUrl(valueOr(localGatewayBaseUrl, "http://127.0.0.1:4310"));
        accessTokenTtl = valueOr(accessTokenTtl, Duration.ofMinutes(15));
        refreshTokenTtl = valueOr(refreshTokenTtl, Duration.ofDays(30));
        pairingCodeTtl = valueOr(pairingCodeTtl, Duration.ofMinutes(10));
        maxSessionsPerUser = positiveOr(maxSessionsPerUser, 10);
        maxDevicesPerUser = positiveOr(maxDevicesPerUser, 10);
        maxHostsPerUser = positiveOr(maxHostsPerUser, 10);
    }

    public String openAiBaseUrl(String slug) {
        return publicHostUrlTemplate.replace("{slug}", slug);
    }

    private static String normalizedBaseUrl(String value) {
        String trimmed = value.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
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

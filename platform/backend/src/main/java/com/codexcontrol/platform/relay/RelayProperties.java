package com.codexcontrol.platform.relay;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "relay")
public record RelayProperties(String internalSecret, Duration tunnelTokenTtl) {
    public RelayProperties {
        internalSecret = internalSecret == null ? "" : internalSecret.trim();
        tunnelTokenTtl = tunnelTokenTtl == null || tunnelTokenTtl.isNegative() || tunnelTokenTtl.isZero()
                ? Duration.ofMinutes(5)
                : tunnelTokenTtl;
    }

    public boolean configured() {
        return internalSecret.length() >= 32;
    }
}

package com.codexcontrol.platform.auth;

import java.time.Instant;
import java.util.UUID;

public record PlatformPrincipal(UUID userId, UUID sessionId, String email, String displayName, Instant accessExpiresAt) {
}

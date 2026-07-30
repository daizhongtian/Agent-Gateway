package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.AccountRole;

import java.time.Instant;
import java.util.UUID;

public record PlatformPrincipal(
        UUID userId,
        UUID sessionId,
        String email,
        String displayName,
        AccountRole role,
        Instant accessExpiresAt
) {
}

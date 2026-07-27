package com.codexcontrol.platform.auth;

import java.time.Instant;

public record IssuedSession(
        AuthSession session,
        String accessToken,
        String refreshToken,
        String csrfToken,
        Instant accessExpiresAt,
        Instant refreshExpiresAt
) {
}

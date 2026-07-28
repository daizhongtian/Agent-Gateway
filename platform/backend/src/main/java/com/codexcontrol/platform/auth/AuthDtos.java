package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.UserAccount;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

public final class AuthDtos {
    private AuthDtos() {
    }

    public enum ClientType {
        BROWSER,
        DESKTOP;

        public static ClientType parse(String value) {
            if (value == null || value.isBlank()) return BROWSER;
            try {
                return valueOf(value.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException error) {
                return BROWSER;
            }
        }
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 320) String email,
            @NotBlank @Size(min = 12, max = 72) String password,
            @Size(max = 80) String displayName,
            @Pattern(regexp = "(?i)browser|desktop") String clientType
    ) {
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 320) String email,
            @NotBlank @Size(max = 72) String password,
            @Pattern(regexp = "(?i)browser|desktop") String clientType
    ) {
    }

    public record RefreshRequest(
            @Size(max = 256) String refreshToken,
            @Pattern(regexp = "(?i)browser|desktop") String clientType
    ) {
    }

    public record DesktopAuthorizeRequest(
            @NotBlank
            @Pattern(regexp = "[A-Za-z0-9_-]{43}")
            String codeChallenge
    ) {
    }

    public record DesktopAuthorizeResponse(String code, Instant expiresAt) {
    }

    public record DesktopExchangeRequest(
            @NotBlank @Size(max = 256) String code,
            @NotBlank @Size(min = 43, max = 128)
            @Pattern(regexp = "[A-Za-z0-9._~-]{43,128}")
            String codeVerifier
    ) {
    }

    public record UserView(
            UUID id,
            String email,
            String displayName,
            String status,
            boolean emailVerified,
            Instant createdAt
    ) {
        public static UserView from(UserAccount user) {
            return new UserView(
                    user.getId(),
                    user.getEmail(),
                    user.getDisplayName(),
                    user.getStatus().name().toLowerCase(Locale.ROOT),
                    user.getEmailVerifiedAt() != null,
                    user.getCreatedAt());
        }
    }

    public record AuthResponse(
            UserView user,
            Instant accessExpiresAt,
            Instant refreshExpiresAt,
            String csrfToken,
            String accessToken,
            String refreshToken
    ) {
    }

    public record SessionResponse(UserView user, Instant accessExpiresAt) {
    }
}

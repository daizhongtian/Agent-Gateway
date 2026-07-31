package com.codexcontrol.platform.relay;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.UUID;

public final class RelayDtos {
    private RelayDtos() {
    }

    public record TunnelTokenRequest(
            @NotNull UUID deviceId,
            @NotNull UUID hostId,
            @NotBlank @Size(min = 20, max = 256) String deviceSecret
    ) {
    }

    public record TunnelTokenResponse(
            String token,
            String relayUrl,
            Instant expiresAt,
            int protocolVersion,
            UUID hostId,
            String slug
    ) {
    }

    public record AdmitRequest(
            @NotBlank @Size(min = 20, max = 256) String token
    ) {
    }

    public record Admission(
            UUID hostId,
            UUID deviceId,
            String slug,
            int protocolVersion
    ) {
    }

    public record PresenceRequest(
            @NotNull UUID hostId,
            @NotNull UUID deviceId,
            @NotBlank @Size(min = 3, max = 160)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String assignment
    ) {
    }

    public record AuthorizeResponse(boolean allowed) {
    }
}

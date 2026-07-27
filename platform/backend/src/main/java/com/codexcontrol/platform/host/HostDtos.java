package com.codexcontrol.platform.host;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

public final class HostDtos {
    private HostDtos() {
    }

    public record CreateHostRequest(
            @NotNull UUID deviceId,
            @NotBlank @Size(min = 2, max = 80) String displayName
    ) {
    }

    public record UpdateHostRequest(
            @NotBlank @Size(min = 2, max = 80) String displayName,
            boolean desiredOnline
    ) {
    }

    public record HostView(
            UUID id,
            UUID deviceId,
            String deviceName,
            String displayName,
            String slug,
            String openAiBaseUrl,
            String status,
            boolean desiredOnline,
            boolean relayReady,
            int protocolVersion,
            Instant lastHeartbeatAt,
            Instant createdAt
    ) {
        public static HostView from(PublicHost host, String baseUrl, boolean relayReady) {
            return new HostView(
                    host.getId(),
                    host.getDevice().getId(),
                    host.getDevice().getName(),
                    host.getDisplayName(),
                    host.getSlug(),
                    baseUrl,
                    host.getStatus().name().toLowerCase(Locale.ROOT),
                    host.isDesiredOnline(),
                    relayReady,
                    host.getProtocolVersion(),
                    host.getLastHeartbeatAt(),
                    host.getCreatedAt());
        }
    }
}

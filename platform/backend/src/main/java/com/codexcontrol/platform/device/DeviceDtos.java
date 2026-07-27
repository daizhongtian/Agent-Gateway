package com.codexcontrol.platform.device;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class DeviceDtos {
    private DeviceDtos() {
    }

    public record CreateDeviceRequest(
            @NotBlank @Size(min = 2, max = 80) String name,
            @NotBlank @Pattern(regexp = "(?i)windows|macos|linux") String platform
    ) {
    }

    public record UpdateDeviceRequest(@NotBlank @Size(min = 2, max = 80) String name) {
    }

    public record DeviceView(
            UUID id,
            String name,
            String platform,
            String status,
            String appVersion,
            Instant pairedAt,
            Instant lastSeenAt,
            Instant createdAt
    ) {
        public static DeviceView from(Device device) {
            return new DeviceView(
                    device.getId(),
                    device.getName(),
                    device.getPlatform().toLowerCase(Locale.ROOT),
                    device.getStatus().name().toLowerCase(Locale.ROOT),
                    device.getAppVersion(),
                    device.getPairedAt(),
                    device.getLastSeenAt(),
                    device.getCreatedAt());
        }
    }

    public record PairingCodeResponse(String code, Instant expiresAt, UUID deviceId) {
    }

    public record DesktopPairRequest(
            @NotBlank @Size(min = 8, max = 16) String code,
            @NotBlank @Size(min = 32, max = 8192) String publicKey,
            @NotBlank @Size(min = 1, max = 40) String appVersion,
            @NotBlank @Pattern(regexp = "(?i)windows|macos|linux") String platform
    ) {
    }

    public record PairedHost(UUID id, String name, String openAiBaseUrl) {
    }

    public record DesktopPairResponse(
            UUID deviceId,
            String deviceSecret,
            String relayUrl,
            boolean relayEnabled,
            int protocolVersion,
            List<PairedHost> hosts
    ) {
    }
}

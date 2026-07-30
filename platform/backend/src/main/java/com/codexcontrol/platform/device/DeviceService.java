package com.codexcontrol.platform.device;

import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.auth.AuthService;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.host.HostStatus;
import com.codexcontrol.platform.host.PublicHostRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class DeviceService {
    private final DeviceRepository deviceRepository;
    private final DevicePairingCodeRepository pairingCodeRepository;
    private final PublicHostRepository hostRepository;
    private final AuthService authService;
    private final CryptoTokens tokens;
    private final PlatformProperties properties;

    public DeviceService(
            DeviceRepository deviceRepository,
            DevicePairingCodeRepository pairingCodeRepository,
            PublicHostRepository hostRepository,
            AuthService authService,
            CryptoTokens tokens,
            PlatformProperties properties
    ) {
        this.deviceRepository = deviceRepository;
        this.pairingCodeRepository = pairingCodeRepository;
        this.hostRepository = hostRepository;
        this.authService = authService;
        this.tokens = tokens;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<DeviceDtos.DeviceView> list(UUID userId) {
        return deviceRepository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(DeviceDtos.DeviceView::from)
                .toList();
    }

    @Transactional
    public DeviceDtos.DeviceView create(UUID userId, DeviceDtos.CreateDeviceRequest request) {
        UserAccount user = authService.lockActiveUser(userId);
        long count = deviceRepository.countByUserIdAndStatusNot(userId, DeviceStatus.REVOKED);
        if (count >= properties.maxDevicesPerUser()) {
            throw new ApiException(HttpStatus.CONFLICT, "DEVICE_LIMIT_REACHED", "Revoke an existing device before creating another one.");
        }
        Device device = deviceRepository.save(new Device(
                user,
                request.name().trim(),
                request.platform().trim().toUpperCase(Locale.ROOT)));
        return DeviceDtos.DeviceView.from(device);
    }

    @Transactional
    public DeviceDtos.DeviceView update(UUID userId, UUID deviceId, DeviceDtos.UpdateDeviceRequest request) {
        Device device = requireOwned(userId, deviceId);
        ensureNotRevoked(device);
        device.rename(request.name().trim());
        return DeviceDtos.DeviceView.from(device);
    }

    @Transactional
    public DeviceDtos.PairingCodeResponse createPairingCode(UUID userId, UUID deviceId) {
        Device device = requireOwned(userId, deviceId);
        ensureNotRevoked(device);
        pairingCodeRepository.deleteByDeviceIdAndUsedAtIsNull(deviceId);
        String raw = tokens.pairingCode();
        Instant expiresAt = Instant.now().plus(properties.pairingCodeTtl());
        pairingCodeRepository.save(new DevicePairingCode(
                device.getUser(), device, tokens.sha256(normalizePairingCode(raw)), expiresAt));
        return new DeviceDtos.PairingCodeResponse(raw, expiresAt, deviceId);
    }

    @Transactional
    public DeviceDtos.DesktopPairResponse pair(DeviceDtos.DesktopPairRequest request) {
        String normalizedCode = normalizePairingCode(request.code());
        DevicePairingCode pairingCode = pairingCodeRepository
                .findByCodeHashAndUsedAtIsNull(tokens.sha256(normalizedCode))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_PAIRING_CODE", "The pairing code is invalid or expired."));
        if (!pairingCode.active(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "PAIRING_CODE_EXPIRED", "The pairing code is invalid or expired.");
        }
        Device device = pairingCode.getDevice();
        ensureNotRevoked(device);
        String secret = tokens.opaque("ccc_dev_", 40);
        String publicKey = request.publicKey().trim();
        device.pair(
                publicKey,
                tokens.sha256(publicKey),
                tokens.sha256(secret),
                request.appVersion().trim());
        pairingCode.consume();

        List<DeviceDtos.PairedHost> hosts = hostRepository.findByDeviceIdOrderByCreatedAtDesc(device.getId()).stream()
                .filter(host -> host.getStatus() != HostStatus.DISABLED)
                .map(host -> new DeviceDtos.PairedHost(
                        host.getId(), host.getDisplayName(), properties.openAiBaseUrl(host.getSlug())))
                .toList();
        return new DeviceDtos.DesktopPairResponse(
                device.getId(),
                secret,
                properties.relayUrl(),
                properties.relayEnabled(),
                1,
                hosts);
    }

    @Transactional
    public void revoke(UUID userId, UUID deviceId) {
        Device device = requireOwned(userId, deviceId);
        device.revoke();
        pairingCodeRepository.deleteByDeviceIdAndUsedAtIsNull(deviceId);
        hostRepository.findByDeviceIdOrderByCreatedAtDesc(deviceId).forEach(host -> {
            if (host.getStatus() != HostStatus.DISABLED) host.disable();
        });
    }

    @Transactional(readOnly = true)
    public Device requireOwned(UUID userId, UUID deviceId) {
        return deviceRepository.findByIdAndUserId(deviceId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_FOUND", "The device was not found."));
    }

    private static void ensureNotRevoked(Device device) {
        if (device.getStatus() == DeviceStatus.REVOKED) {
            throw new ApiException(HttpStatus.CONFLICT, "DEVICE_REVOKED", "The device has been revoked.");
        }
    }

    private static String normalizePairingCode(String value) {
        String compact = value == null ? "" : value.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        return compact.length() == 8 ? compact.substring(0, 4) + "-" + compact.substring(4) : compact;
    }
}

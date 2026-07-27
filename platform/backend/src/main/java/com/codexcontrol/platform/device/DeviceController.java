package com.codexcontrol.platform.device;

import com.codexcontrol.platform.auth.PlatformPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {
    private final DeviceService deviceService;

    public DeviceController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @GetMapping
    public List<DeviceDtos.DeviceView> list(@AuthenticationPrincipal PlatformPrincipal principal) {
        return deviceService.list(principal.userId());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DeviceDtos.DeviceView create(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @Valid @RequestBody DeviceDtos.CreateDeviceRequest request
    ) {
        return deviceService.create(principal.userId(), request);
    }

    @PatchMapping("/{deviceId}")
    public DeviceDtos.DeviceView update(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID deviceId,
            @Valid @RequestBody DeviceDtos.UpdateDeviceRequest request
    ) {
        return deviceService.update(principal.userId(), deviceId, request);
    }

    @PostMapping("/{deviceId}/pairing-code")
    public DeviceDtos.PairingCodeResponse pairingCode(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID deviceId
    ) {
        return deviceService.createPairingCode(principal.userId(), deviceId);
    }

    @DeleteMapping("/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID deviceId
    ) {
        deviceService.revoke(principal.userId(), deviceId);
    }
}

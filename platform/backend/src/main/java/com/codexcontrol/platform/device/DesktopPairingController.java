package com.codexcontrol.platform.device;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/desktop")
public class DesktopPairingController {
    private final DeviceService deviceService;

    public DesktopPairingController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @PostMapping("/pair")
    public DeviceDtos.DesktopPairResponse pair(@Valid @RequestBody DeviceDtos.DesktopPairRequest request) {
        return deviceService.pair(request);
    }
}

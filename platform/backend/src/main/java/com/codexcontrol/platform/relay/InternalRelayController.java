package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.host.HostService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@RestController
@RequestMapping("/internal/v1/relay")
public class InternalRelayController {
    private final TunnelTokenService tokenService;
    private final HostService hostService;
    private final RelayProperties properties;

    public InternalRelayController(
            TunnelTokenService tokenService,
            HostService hostService,
            RelayProperties properties
    ) {
        this.tokenService = tokenService;
        this.hostService = hostService;
        this.properties = properties;
    }

    @PostMapping("/admit")
    public RelayDtos.Admission admit(
            @RequestHeader(name = "X-Relay-Secret", required = false) String secret,
            @Valid @RequestBody RelayDtos.AdmitRequest request
    ) {
        authenticate(secret);
        return tokenService.consume(request.token());
    }

    @PostMapping("/ready")
    public void ready(
            @RequestHeader(name = "X-Relay-Secret", required = false) String secret,
            @Valid @RequestBody RelayDtos.PresenceRequest request
    ) {
        authenticate(secret);
        hostService.markRelayOnline(request.hostId(), request.deviceId(), request.assignment());
    }

    @PostMapping("/heartbeat")
    public void heartbeat(
            @RequestHeader(name = "X-Relay-Secret", required = false) String secret,
            @Valid @RequestBody RelayDtos.PresenceRequest request
    ) {
        authenticate(secret);
        hostService.markRelayHeartbeat(request.hostId(), request.deviceId(), request.assignment());
    }

    @PostMapping("/disconnect")
    public void disconnect(
            @RequestHeader(name = "X-Relay-Secret", required = false) String secret,
            @Valid @RequestBody RelayDtos.PresenceRequest request
    ) {
        authenticate(secret);
        hostService.markRelayOffline(request.hostId(), request.deviceId(), request.assignment());
    }

    @GetMapping("/hosts/{slug}/authorize")
    public RelayDtos.AuthorizeResponse authorize(
            @RequestHeader(name = "X-Relay-Secret", required = false) String secret,
            @PathVariable String slug,
            @RequestParam String assignment
    ) {
        authenticate(secret);
        if (assignment.length() > 160) return new RelayDtos.AuthorizeResponse(false);
        return new RelayDtos.AuthorizeResponse(hostService.relayAssignmentActive(slug, assignment));
    }

    private void authenticate(String provided) {
        byte[] expected = properties.internalSecret().getBytes(StandardCharsets.UTF_8);
        byte[] actual = provided == null ? new byte[0] : provided.getBytes(StandardCharsets.UTF_8);
        if (!properties.configured() || !MessageDigest.isEqual(expected, actual)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "RELAY_AUTHENTICATION_FAILED", "Relay authentication failed.");
        }
    }
}

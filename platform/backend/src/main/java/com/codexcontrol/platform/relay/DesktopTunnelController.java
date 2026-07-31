package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.auth.PlatformPrincipal;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/desktop")
public class DesktopTunnelController {
    private final TunnelTokenService tokenService;

    public DesktopTunnelController(TunnelTokenService tokenService) {
        this.tokenService = tokenService;
    }

    @PostMapping("/tunnel-token")
    public RelayDtos.TunnelTokenResponse issue(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @Valid @RequestBody RelayDtos.TunnelTokenRequest request
    ) {
        return tokenService.issue(principal.userId(), request);
    }
}

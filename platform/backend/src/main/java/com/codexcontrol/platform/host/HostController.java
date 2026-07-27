package com.codexcontrol.platform.host;

import com.codexcontrol.platform.auth.PlatformPrincipal;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
@RequestMapping("/api/v1/hosts")
public class HostController {
    private final HostService hostService;

    public HostController(HostService hostService) {
        this.hostService = hostService;
    }

    @GetMapping
    public List<HostDtos.HostView> list(@AuthenticationPrincipal PlatformPrincipal principal) {
        return hostService.list(principal.userId());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public HostDtos.HostView create(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @Valid @RequestBody HostDtos.CreateHostRequest request
    ) {
        return hostService.create(principal.userId(), request);
    }

    @PatchMapping("/{hostId}")
    public HostDtos.HostView update(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID hostId,
            @Valid @RequestBody HostDtos.UpdateHostRequest request
    ) {
        return hostService.update(principal.userId(), hostId, request);
    }

    @PostMapping("/{hostId}/disable")
    public HostDtos.HostView disable(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID hostId
    ) {
        return hostService.disable(principal.userId(), hostId);
    }

    @PostMapping("/{hostId}/enable")
    public HostDtos.HostView enable(
            @AuthenticationPrincipal PlatformPrincipal principal,
            @PathVariable UUID hostId
    ) {
        return hostService.enable(principal.userId(), hostId);
    }
}

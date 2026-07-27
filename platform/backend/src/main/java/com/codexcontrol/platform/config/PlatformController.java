package com.codexcontrol.platform.config;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class PlatformController {
    private final PlatformProperties properties;
    private final JdbcTemplate jdbcTemplate;

    public PlatformController(PlatformProperties properties, JdbcTemplate jdbcTemplate) {
        this.properties = properties;
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "status", "ok", "timestamp", Instant.now());
    }

    @GetMapping("/readiness")
    public ResponseEntity<Map<String, Object>> readiness() {
        try {
            Integer result = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            boolean ready = result != null && result == 1;
            return ResponseEntity.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("ok", ready, "database", ready ? "ready" : "unavailable"));
        } catch (RuntimeException error) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("ok", false, "database", "unavailable"));
        }
    }

    @GetMapping("/platform/config")
    public PlatformConfigResponse config() {
        return new PlatformConfigResponse(
                "0.1.0",
                properties.publicHostDomain(),
                properties.relayUrl(),
                properties.relayEnabled(),
                1,
                new String[]{"GET /v1/models", "POST /v1/responses", "POST /v1/chat/completions"});
    }

    public record PlatformConfigResponse(
            String platformVersion,
            String publicHostDomain,
            String relayUrl,
            boolean relayEnabled,
            int relayProtocolVersion,
            String[] allowedPublicRoutes
    ) {
    }
}

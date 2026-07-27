package com.codexcontrol.platform.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlatformControllerTest {
    private final PlatformProperties properties = new PlatformProperties(
            null, null, null, false, false,
            null, null, null, 0, 0, 0);

    @Test
    void readinessReportsUnavailableWhenDatabaseQueryFails() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenThrow(new IllegalStateException("database down"));

        var response = new PlatformController(properties, jdbc).readiness();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).containsEntry("ok", false).containsEntry("database", "unavailable");
    }

    @Test
    void readinessReportsUnavailableForUnexpectedProbeValue() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(0);

        var response = new PlatformController(properties, jdbc).readiness();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }
}

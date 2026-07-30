package com.codexcontrol.platform.admin;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AuditEventTest {
    @Test
    void persistenceInitializationIsStableWhenInvokedMoreThanOnce() {
        AuditEvent event = new AuditEvent(null, null, null, "TEST_ACTION", Map.of("targetType", "test"));

        event.beforeCreate();
        var id = event.getId();
        Instant createdAt = event.getCreatedAt();
        event.beforeCreate();

        assertThat(event.getId()).isEqualTo(id);
        assertThat(event.getCreatedAt()).isEqualTo(createdAt);
        assertThat(event.getActor()).isNull();
        assertThat(event.getDevice()).isNull();
        assertThat(event.getHost()).isNull();
        assertThat(event.getAction()).isEqualTo("TEST_ACTION");
        assertThat(event.getOutcome()).isEqualTo("SUCCESS");
        assertThat(event.getDetails()).containsEntry("targetType", "test");
    }
}

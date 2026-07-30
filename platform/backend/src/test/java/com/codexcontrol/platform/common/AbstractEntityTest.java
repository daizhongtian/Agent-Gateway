package com.codexcontrol.platform.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AbstractEntityTest {
    @Test
    void lifecycleCallbacksAreIdempotentAndUpdateTheTimestamp() {
        TestEntity entity = new TestEntity();
        entity.create();
        var id = entity.getId();
        var createdAt = entity.getCreatedAt();
        var firstUpdatedAt = entity.getUpdatedAt();

        entity.create();
        assertThat(entity.getId()).isEqualTo(id);
        assertThat(entity.getCreatedAt()).isEqualTo(createdAt);
        assertThat(entity.getUpdatedAt()).isAfterOrEqualTo(firstUpdatedAt);

        entity.updateTimestamp();
        assertThat(entity.getUpdatedAt()).isAfterOrEqualTo(firstUpdatedAt);
    }

    private static final class TestEntity extends AbstractEntity {
        void create() {
            beforeCreate();
        }

        void updateTimestamp() {
            beforeUpdate();
        }
    }
}

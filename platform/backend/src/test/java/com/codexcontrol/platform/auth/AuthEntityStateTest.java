package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.UserAccount;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class AuthEntityStateTest {
    @Test
    void sessionLifecycleIsIdempotentAndHonorsBothExpiries() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Instant now = Instant.now();
        AuthSession session = new AuthSession(
                user, "access", "refresh", "csrf",
                now.plusSeconds(60), now.plusSeconds(120), "Agent Gateway", null);

        session.beforeCreate();
        var originalId = session.getId();
        session.beforeCreate();
        assertThat(session.getId()).isEqualTo(originalId);
        assertThat(session.accessActive(now)).isTrue();
        assertThat(session.accessActive(now.plusSeconds(61))).isFalse();
        assertThat(session.refreshActive(now)).isTrue();
        assertThat(session.refreshActive(now.plusSeconds(121))).isFalse();

        session.touch();
        session.rotate("access-2", "refresh-2", "csrf-2", now.plusSeconds(90), now.plusSeconds(180));
        assertThat(session.getCsrfTokenHash()).isEqualTo("csrf-2");
        session.revoke();
        Instant revokedAt = session.getRevokedAt();
        session.revoke();
        assertThat(session.getRevokedAt()).isEqualTo(revokedAt);
        assertThat(session.accessActive(now)).isFalse();
        assertThat(session.refreshActive(now)).isFalse();
    }

    @Test
    void desktopAuthorizationCanBeConsumedOnlyOnceAndCannotOutliveItsExpiry() {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        Instant now = Instant.now();
        DesktopAuthorizationCode code = new DesktopAuthorizationCode(user, "hash", "challenge", now.plusSeconds(60));

        code.beforeCreate();
        code.beforeCreate();
        assertThat(code.active(now)).isTrue();
        assertThat(code.active(now.plusSeconds(61))).isFalse();
        code.consume(now.plusSeconds(1));
        code.consume(now.plusSeconds(2));
        assertThat(code.active(now)).isFalse();
        assertThat(code.getUser()).isSameAs(user);
        assertThat(code.getCodeChallenge()).isEqualTo("challenge");
        assertThat(code.getExpiresAt()).isEqualTo(now.plusSeconds(60));
    }
}

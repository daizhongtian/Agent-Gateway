package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.device.DevicePairingCodeRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class CredentialRetentionServiceTest {
    @Test
    void deletesEveryCredentialTypeAfterItsLogicalExpiry() {
        AuthSessionRepository sessions = mock(AuthSessionRepository.class);
        DesktopAuthorizationCodeRepository desktopCodes = mock(DesktopAuthorizationCodeRepository.class);
        DevicePairingCodeRepository pairingCodes = mock(DevicePairingCodeRepository.class);
        Instant now = Instant.parse("2026-07-30T12:00:00Z");
        CredentialRetentionService service = new CredentialRetentionService(
                sessions, desktopCodes, pairingCodes, Clock.fixed(now, ZoneOffset.UTC));

        service.deleteExpiredCredentials();

        verify(sessions).deleteByRefreshExpiresAtBefore(now);
        verify(desktopCodes).deleteByExpiresAtBefore(now);
        verify(pairingCodes).deleteByExpiresAtBefore(now);
    }
}

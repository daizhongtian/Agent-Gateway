package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.device.DevicePairingCodeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

@Service
public class CredentialRetentionService {
    private final AuthSessionRepository sessions;
    private final DesktopAuthorizationCodeRepository desktopCodes;
    private final DevicePairingCodeRepository pairingCodes;
    private final Clock clock;

    @Autowired
    public CredentialRetentionService(
            AuthSessionRepository sessions,
            DesktopAuthorizationCodeRepository desktopCodes,
            DevicePairingCodeRepository pairingCodes
    ) {
        this(sessions, desktopCodes, pairingCodes, Clock.systemUTC());
    }

    CredentialRetentionService(
            AuthSessionRepository sessions,
            DesktopAuthorizationCodeRepository desktopCodes,
            DevicePairingCodeRepository pairingCodes,
            Clock clock
    ) {
        this.sessions = sessions;
        this.desktopCodes = desktopCodes;
        this.pairingCodes = pairingCodes;
        this.clock = clock;
    }

    @Scheduled(initialDelayString = "PT10M", fixedDelayString = "PT1H")
    @Transactional
    public void deleteExpiredCredentials() {
        Instant now = clock.instant();
        sessions.deleteByRefreshExpiresAtBefore(now);
        desktopCodes.deleteByExpiresAtBefore(now);
        pairingCodes.deleteByExpiresAtBefore(now);
    }
}

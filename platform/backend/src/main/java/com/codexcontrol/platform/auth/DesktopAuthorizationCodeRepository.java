package com.codexcontrol.platform.auth;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.Optional;
import java.time.Instant;
import java.util.UUID;

public interface DesktopAuthorizationCodeRepository extends JpaRepository<DesktopAuthorizationCode, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<DesktopAuthorizationCode> findByCodeHashAndConsumedAtIsNull(String codeHash);
    void deleteByExpiresAtBefore(Instant cutoff);
}

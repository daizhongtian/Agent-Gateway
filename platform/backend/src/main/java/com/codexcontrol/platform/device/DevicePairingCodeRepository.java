package com.codexcontrol.platform.device;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface DevicePairingCodeRepository extends JpaRepository<DevicePairingCode, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<DevicePairingCode> findByCodeHashAndUsedAtIsNull(String codeHash);
    @Modifying
    void deleteByDeviceIdAndUsedAtIsNull(UUID deviceId);
    void deleteByExpiresAtBefore(Instant cutoff);
}

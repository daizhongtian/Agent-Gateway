package com.codexcontrol.platform.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import jakarta.persistence.LockModeType;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {
    Optional<AuthSession> findByAccessTokenHashAndRevokedAtIsNull(String accessTokenHash);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<AuthSession> findByRefreshTokenHashAndRevokedAtIsNull(String refreshTokenHash);
    List<AuthSession> findByUserIdAndRevokedAtIsNullOrderByCreatedAtAsc(UUID userId);

    @Modifying
    @Query("update AuthSession session set session.revokedAt = :now where session.user.id = :userId and session.revokedAt is null")
    int revokeAllForUser(UUID userId, Instant now);

    void deleteByRefreshExpiresAtBefore(Instant cutoff);
}

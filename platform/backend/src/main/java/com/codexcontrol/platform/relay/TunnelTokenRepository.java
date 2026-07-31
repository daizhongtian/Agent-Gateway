package com.codexcontrol.platform.relay;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface TunnelTokenRepository extends JpaRepository<TunnelToken, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select token from TunnelToken token where token.tokenHash = :tokenHash and token.usedAt is null")
    Optional<TunnelToken> findActiveForUpdate(@Param("tokenHash") String tokenHash);
}

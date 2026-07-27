package com.codexcontrol.platform.host;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PublicHostRepository extends JpaRepository<PublicHost, UUID> {
    List<PublicHost> findByUserIdOrderByCreatedAtDesc(UUID userId);
    Optional<PublicHost> findByIdAndUserId(UUID id, UUID userId);
    List<PublicHost> findByDeviceIdOrderByCreatedAtDesc(UUID deviceId);
    boolean existsBySlug(String slug);
    long countByUserId(UUID userId);
    long countByDeviceIdAndStatusNot(UUID deviceId, HostStatus status);
}

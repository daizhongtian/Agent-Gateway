package com.codexcontrol.platform.device;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DeviceRepository extends JpaRepository<Device, UUID> {
    List<Device> findByUserIdOrderByCreatedAtDesc(UUID userId);
    Optional<Device> findByIdAndUserId(UUID id, UUID userId);
    long countByUserIdAndStatusNot(UUID userId, DeviceStatus status);
    Page<Device> findAllByOrderByCreatedAtDesc(Pageable pageable);
    long countByStatus(DeviceStatus status);
}

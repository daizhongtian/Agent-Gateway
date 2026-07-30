package com.codexcontrol.platform.account;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.Optional;
import java.util.UUID;

public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {
    Optional<UserAccount> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
    Page<UserAccount> findAllByOrderByCreatedAtDesc(Pageable pageable);
    long countByStatus(AccountStatus status);
    long countByRoleAndStatus(AccountRole role, AccountStatus status);
}

package com.codexcontrol.platform.account;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.List;
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

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select user from UserAccount user where user.id = :id")
    Optional<UserAccount> findByIdForUpdate(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select user from UserAccount user where user.role = :role order by user.id")
    List<UserAccount> findByRoleForUpdate(@Param("role") AccountRole role);
}

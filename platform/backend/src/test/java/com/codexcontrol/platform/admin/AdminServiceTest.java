package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import com.codexcontrol.platform.auth.AuthSessionRepository;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.device.DeviceRepository;
import com.codexcontrol.platform.device.DeviceService;
import com.codexcontrol.platform.host.HostService;
import com.codexcontrol.platform.host.PublicHostRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminServiceTest {
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final AuthSessionRepository sessions = mock(AuthSessionRepository.class);
    private final DeviceRepository devices = mock(DeviceRepository.class);
    private final PublicHostRepository hosts = mock(PublicHostRepository.class);
    private final AuditEventRepository audit = mock(AuditEventRepository.class);
    private final DeviceService deviceService = mock(DeviceService.class);
    private final HostService hostService = mock(HostService.class);
    private final AdminService service = new AdminService(users, sessions, devices, hosts, audit, deviceService, hostService);
    private final UUID actorId = UUID.randomUUID();
    private final UUID targetId = UUID.randomUUID();
    private final UserAccount actor = new UserAccount("actor@example.com", "hash", "Actor");
    private final UserAccount target = new UserAccount("target@example.com", "hash", "Target");

    @BeforeEach
    void setUp() {
        actor.promoteToAdmin();
        target.promoteToAdmin();
        when(users.findById(actorId)).thenReturn(Optional.of(actor));
        when(users.findById(targetId)).thenReturn(Optional.of(target));
        when(users.findByRoleForUpdate(AccountRole.ADMIN)).thenReturn(List.of(actor, target));
        when(devices.findByUserIdOrderByCreatedAtDesc(targetId)).thenReturn(List.of());
    }

    @Test
    void theLastActiveAdministratorCannotBeDisabled() {
        when(users.findByRoleForUpdate(AccountRole.ADMIN)).thenReturn(List.of(target));

        assertThatThrownBy(() -> service.disableUser(actorId, targetId, null, null))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.code()).isEqualTo("LAST_ADMIN_REQUIRED"));

        verify(sessions, never()).revokeAllForUser(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void oneOfMultipleAdministratorsCanBeDisabledWithFullAuditDetails() {
        AdminDtos.UserView result = service.disableUser(actorId, targetId, " security review ", "req_test");

        assertThat(result.status()).isEqualTo("disabled");
        verify(sessions).revokeAllForUser(org.mockito.ArgumentMatchers.eq(targetId), org.mockito.ArgumentMatchers.any());
        ArgumentCaptor<AuditEvent> event = ArgumentCaptor.forClass(AuditEvent.class);
        verify(audit).save(event.capture());
        assertThat(event.getValue().getDetails())
                .containsEntry("reason", "security review")
                .containsEntry("requestId", "req_test");
    }

    @Test
    void disablingAnAlreadyDisabledAdministratorSkipsLastAdminCountingAndOptionalAuditFields() {
        target.disable();

        AdminDtos.UserView result = service.disableUser(actorId, targetId, null, null);

        assertThat(result.status()).isEqualTo("disabled");
        verify(users).findByRoleForUpdate(AccountRole.ADMIN);
        ArgumentCaptor<AuditEvent> event = ArgumentCaptor.forClass(AuditEvent.class);
        verify(audit).save(event.capture());
        assertThat(event.getValue().getDetails()).doesNotContainKeys("reason", "requestId");
    }
}

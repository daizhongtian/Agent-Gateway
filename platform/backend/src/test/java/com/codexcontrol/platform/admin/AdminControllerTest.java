package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.auth.PlatformPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class AdminControllerTest {
    @Test
    void aRequestWithoutFilterMetadataPassesANullRequestIdToTheAuditService() {
        AdminService service = mock(AdminService.class);
        AdminController controller = new AdminController(service);
        UUID actorId = UUID.randomUUID();
        UUID targetId = UUID.randomUUID();
        PlatformPrincipal principal = new PlatformPrincipal(
                actorId, UUID.randomUUID(), "admin@example.com", "Admin", AccountRole.ADMIN, Instant.now().plusSeconds(60));

        controller.enableUser(principal, targetId, new AdminDtos.ActionRequest(null), mock(HttpServletRequest.class));

        verify(service).enableUser(actorId, targetId, null, null);
    }
}

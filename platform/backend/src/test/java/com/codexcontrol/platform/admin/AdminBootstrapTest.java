package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminBootstrapTest {
    private final UserAccountRepository users = mock(UserAccountRepository.class);

    @Test
    void blankConfigurationDoesNothing() throws Exception {
        new AdminBootstrap(users, "  ").run(new DefaultApplicationArguments());
        new AdminBootstrap(users, null).run(new DefaultApplicationArguments());
        verify(users, never()).findByEmailIgnoreCase(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void configuredExistingAccountIsPromotedCaseInsensitively() throws Exception {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        when(users.findByEmailIgnoreCase("owner@example.com")).thenReturn(Optional.of(user));

        new AdminBootstrap(users, " OWNER@EXAMPLE.COM ").run(new DefaultApplicationArguments());

        assertThat(user.getRole()).isEqualTo(AccountRole.ADMIN);
    }

    @Test
    void missingOrAlreadyPromotedAccountsAreSafeNoOps() throws Exception {
        when(users.findByEmailIgnoreCase("missing@example.com")).thenReturn(Optional.empty());
        new AdminBootstrap(users, "missing@example.com").run(new DefaultApplicationArguments());

        UserAccount admin = new UserAccount("admin@example.com", "hash", "Admin");
        admin.promoteToAdmin();
        when(users.findByEmailIgnoreCase("admin@example.com")).thenReturn(Optional.of(admin));
        new AdminBootstrap(users, "admin@example.com").run(new DefaultApplicationArguments());

        assertThat(admin.getRole()).isEqualTo(AccountRole.ADMIN);
    }
}

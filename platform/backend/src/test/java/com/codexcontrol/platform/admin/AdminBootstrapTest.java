package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminBootstrapTest {
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);

    @Test
    void blankConfigurationDoesNothing() throws Exception {
        new AdminBootstrap(users, passwords, "", "  ", "").run(new DefaultApplicationArguments());
        new AdminBootstrap(users, passwords, null, null, null).run(new DefaultApplicationArguments());
        verify(users, never()).findByEmailIgnoreCase(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void malformedBootstrapEmailIsRejectedWithoutCrashingOrQueryingAccounts() throws Exception {
        for (String email : new String[] { "not-an-email", "a@@example.com", "missing-domain@", "white space@example.com" }) {
            new AdminBootstrap(users, passwords, "admin", email, "a-secure-bootstrap-password")
                    .run(new DefaultApplicationArguments());
        }
        new AdminBootstrap(users, passwords, "admin", "valid@example.com", "too-short")
                .run(new DefaultApplicationArguments());
        new AdminBootstrap(users, passwords, "admin", "valid@example.com", "x".repeat(73))
                .run(new DefaultApplicationArguments());
        new AdminBootstrap(users, passwords, "invalid username", "valid@example.com", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());

        verify(users, never()).findByEmailIgnoreCase(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void configuredExistingAccountIsPromotedCaseInsensitively() throws Exception {
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        when(users.findByEmailIgnoreCase("owner@example.com")).thenReturn(Optional.of(user));
        when(passwords.matches("a-secure-bootstrap-password", "hash")).thenReturn(true);

        new AdminBootstrap(users, passwords, "owner", " OWNER@EXAMPLE.COM ", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());

        assertThat(user.getRole()).isEqualTo(AccountRole.ADMIN);
    }

    @Test
    void missingAccountIsCreatedAndAnAlreadyPromotedAccountIsSafe() throws Exception {
        when(users.findByEmailIgnoreCase("missing@example.com")).thenReturn(Optional.empty());
        when(passwords.encode("a-secure-bootstrap-password")).thenReturn("encoded");
        new AdminBootstrap(users, passwords, "missing-admin", "missing@example.com", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());
        verify(users).save(org.mockito.ArgumentMatchers.argThat(user ->
                user.getRole() == AccountRole.ADMIN && user.getUsername().equals("missing-admin")));

        UserAccount admin = new UserAccount("admin@example.com", "hash", "Admin");
        admin.promoteToAdmin();
        when(users.findByEmailIgnoreCase("admin@example.com")).thenReturn(Optional.of(admin));
        when(passwords.matches("a-secure-bootstrap-password", "hash")).thenReturn(true);
        new AdminBootstrap(users, passwords, "admin", "admin@example.com", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());

        assertThat(admin.getRole()).isEqualTo(AccountRole.ADMIN);
    }

    @Test
    void claimedEmailWithDifferentPasswordIsNeverPromoted() throws Exception {
        UserAccount user = new UserAccount("claimed@example.com", "attacker-hash", "Claimed");
        when(users.findByEmailIgnoreCase("claimed@example.com")).thenReturn(Optional.of(user));
        when(passwords.matches("owner-bootstrap-password", "attacker-hash")).thenReturn(false);

        new AdminBootstrap(users, passwords, "claimed", "claimed@example.com", "owner-bootstrap-password")
                .run(new DefaultApplicationArguments());

        assertThat(user.getRole()).isEqualTo(AccountRole.USER);
    }

    @Test
    void verifiedLegacyAccountCanAdoptTheConfiguredUsername() throws Exception {
        UserAccount admin = new UserAccount("legacy@example.com", "hash", "Legacy");
        admin.promoteToAdmin();
        when(users.findByEmailIgnoreCase("legacy@example.com")).thenReturn(Optional.of(admin));
        when(users.findByUsernameIgnoreCase("dai2003")).thenReturn(Optional.empty());
        when(passwords.matches("a-secure-bootstrap-password", "hash")).thenReturn(true);

        new AdminBootstrap(users, passwords, " DAI2003 ", "legacy@example.com", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());

        assertThat(admin.getUsername()).isEqualTo("dai2003");
        assertThat(admin.getRole()).isEqualTo(AccountRole.ADMIN);
    }

    @Test
    void claimedUsernameNeverChangesOrCreatesAnAdministrator() throws Exception {
        UserAccount target = new UserAccount("legacy", "target@example.com", "target-hash", "Target");
        UserAccount owner = new UserAccount("dai2003", "owner@example.com", "owner-hash", "Owner");
        when(users.findByEmailIgnoreCase("target@example.com")).thenReturn(Optional.of(target));
        when(users.findByUsernameIgnoreCase("dai2003")).thenReturn(Optional.of(owner));
        when(passwords.matches("a-secure-bootstrap-password", "target-hash")).thenReturn(true);

        new AdminBootstrap(users, passwords, "dai2003", "target@example.com", "a-secure-bootstrap-password")
                .run(new DefaultApplicationArguments());

        assertThat(target.getUsername()).isEqualTo("legacy");
        assertThat(target.getRole()).isEqualTo(AccountRole.USER);
        verify(users, never()).save(org.mockito.ArgumentMatchers.any(UserAccount.class));
    }
}

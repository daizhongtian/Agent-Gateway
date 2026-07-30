package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Locale;

@Component
public class AdminBootstrap implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final UserAccountRepository users;
    private final String bootstrapEmail;
    private final String bootstrapPassword;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrap(
            UserAccountRepository users,
            PasswordEncoder passwordEncoder,
            @Value("${platform.bootstrap-admin-email:}") String bootstrapEmail,
            @Value("${platform.bootstrap-admin-password:}") String bootstrapPassword
    ) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.bootstrapEmail = bootstrapEmail == null ? "" : bootstrapEmail.trim().toLowerCase(Locale.ROOT);
        this.bootstrapPassword = bootstrapPassword == null ? "" : bootstrapPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (bootstrapEmail.isBlank() && bootstrapPassword.isBlank()) return;
        int at = bootstrapEmail.indexOf('@');
        boolean invalidEmail = at <= 0
                || at != bootstrapEmail.lastIndexOf('@')
                || at == bootstrapEmail.length() - 1
                || bootstrapEmail.chars().anyMatch(Character::isWhitespace);
        if (invalidEmail || bootstrapPassword.length() < 12 || bootstrapPassword.length() > 72) {
            log.error("Bootstrap administrator requires both an email and a 12-72 character password; no account was promoted");
            return;
        }
        users.findByEmailIgnoreCase(bootstrapEmail).ifPresentOrElse(user -> {
            if (user.getRole() != AccountRole.ADMIN && passwordEncoder.matches(bootstrapPassword, user.getPasswordHash())) {
                user.promoteToAdmin();
                log.info("Promoted configured bootstrap account {} to administrator", user.getId());
            } else if (user.getRole() != AccountRole.ADMIN) {
                log.error("Bootstrap administrator email is already claimed by an account with a different password; no account was promoted");
            }
        }, () -> {
            UserAccount user = new UserAccount(
                    bootstrapEmail,
                    passwordEncoder.encode(bootstrapPassword),
                    bootstrapEmail.substring(0, at));
            user.promoteToAdmin();
            users.save(user);
            log.info("Created configured bootstrap administrator account");
        });
    }
}

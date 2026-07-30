package com.codexcontrol.platform.admin;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.UserAccountRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Component
public class AdminBootstrap implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final UserAccountRepository users;
    private final String bootstrapEmail;

    public AdminBootstrap(
            UserAccountRepository users,
            @Value("${platform.bootstrap-admin-email:}") String bootstrapEmail
    ) {
        this.users = users;
        this.bootstrapEmail = bootstrapEmail == null ? "" : bootstrapEmail.trim().toLowerCase(Locale.ROOT);
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (bootstrapEmail.isBlank()) return;
        users.findByEmailIgnoreCase(bootstrapEmail).ifPresentOrElse(user -> {
            if (user.getRole() != AccountRole.ADMIN) {
                user.promoteToAdmin();
                log.info("Promoted configured bootstrap account {} to administrator", user.getId());
            }
        }, () -> log.warn("Configured bootstrap administrator account does not exist yet; create it and restart the backend"));
    }
}

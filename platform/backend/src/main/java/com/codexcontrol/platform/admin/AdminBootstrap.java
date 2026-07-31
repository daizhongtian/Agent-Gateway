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

import java.text.Normalizer;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

@Component
public class AdminBootstrap implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);
    private static final Pattern USERNAME = Pattern.compile("^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}._-]{1,30}[\\p{L}\\p{N}])?$");

    private final UserAccountRepository users;
    private final String bootstrapUsername;
    private final String bootstrapEmail;
    private final String bootstrapPassword;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrap(
            UserAccountRepository users,
            PasswordEncoder passwordEncoder,
            @Value("${platform.bootstrap-admin-username:}") String bootstrapUsername,
            @Value("${platform.bootstrap-admin-email:}") String bootstrapEmail,
            @Value("${platform.bootstrap-admin-password:}") String bootstrapPassword
    ) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.bootstrapUsername = normalizeUsername(bootstrapUsername);
        this.bootstrapEmail = bootstrapEmail == null ? "" : bootstrapEmail.trim().toLowerCase(Locale.ROOT);
        this.bootstrapPassword = bootstrapPassword == null ? "" : bootstrapPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (bootstrapUsername.isBlank() && bootstrapEmail.isBlank() && bootstrapPassword.isBlank()) return;
        int at = bootstrapEmail.indexOf('@');
        String username = bootstrapUsername.isBlank()
                ? normalizeUsername(at > 0 ? bootstrapEmail.substring(0, at) : "")
                : bootstrapUsername;
        boolean invalidEmail = at <= 0
                || at != bootstrapEmail.lastIndexOf('@')
                || at == bootstrapEmail.length() - 1
                || bootstrapEmail.chars().anyMatch(Character::isWhitespace);
        if (invalidEmail || !USERNAME.matcher(username).matches()
                || bootstrapPassword.length() < 12 || bootstrapPassword.length() > 72) {
            log.error("Bootstrap administrator requires a valid username, email, and 12-72 character password; no account was promoted");
            return;
        }
        users.findByEmailIgnoreCase(bootstrapEmail).ifPresentOrElse(user -> {
            if (!passwordEncoder.matches(bootstrapPassword, user.getPasswordHash())) {
                log.error("Bootstrap administrator email is already claimed by an account with a different password; no account was promoted");
                return;
            }
            if (!user.getUsername().equalsIgnoreCase(username)) {
                var claimed = users.findByUsernameIgnoreCase(username);
                boolean sameAccount = claimed.isPresent() && (claimed.get() == user
                        || user.getId() != null && Objects.equals(claimed.get().getId(), user.getId()));
                if (claimed.isPresent() && !sameAccount) {
                    log.error("Bootstrap administrator username is already claimed by another account; no account was changed");
                    return;
                }
                user.changeUsername(username);
            }
            if (user.getRole() != AccountRole.ADMIN) user.promoteToAdmin();
            log.info("Verified configured bootstrap administrator {}", user.getId());
        }, () -> {
            if (users.existsByUsernameIgnoreCase(username)) {
                log.error("Bootstrap administrator username is already claimed by another account; no account was created");
                return;
            }
            UserAccount user = new UserAccount(
                    username,
                    bootstrapEmail,
                    passwordEncoder.encode(bootstrapPassword),
                    username);
            user.promoteToAdmin();
            users.save(user);
            log.info("Created configured bootstrap administrator account");
        });
    }

    private static String normalizeUsername(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }
}

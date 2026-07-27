package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {
    private final UserAccountRepository userRepository;
    private final AuthSessionRepository sessionRepository;
    private final PasswordEncoder passwordEncoder;
    private final CryptoTokens tokens;
    private final PlatformProperties properties;
    private final String dummyPasswordHash;

    public AuthService(
            UserAccountRepository userRepository,
            AuthSessionRepository sessionRepository,
            PasswordEncoder passwordEncoder,
            CryptoTokens tokens,
            PlatformProperties properties
    ) {
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokens = tokens;
        this.properties = properties;
        this.dummyPasswordHash = passwordEncoder.encode(tokens.opaque("timing_", 24));
    }

    @Transactional
    public IssuedSession register(AuthDtos.RegisterRequest request, HttpServletRequest servletRequest) {
        String email = normalizeEmail(request.email());
        ensurePasswordFitsEncoder(request.password());
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_REGISTERED", "An account already exists for this email address.");
        }
        UserAccount user = userRepository.save(new UserAccount(
                email,
                passwordEncoder.encode(request.password()),
                registrationDisplayName(request.displayName(), email)));
        return createSession(user, servletRequest);
    }

    @Transactional
    public IssuedSession login(AuthDtos.LoginRequest request, HttpServletRequest servletRequest) {
        String email = normalizeEmail(request.email());
        UserAccount user = userRepository.findByEmailIgnoreCase(email).orElse(null);
        String candidateHash = user == null ? dummyPasswordHash : user.getPasswordHash();
        boolean valid = passwordEncoder.matches(request.password(), candidateHash) && user != null;
        if (!valid) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "The email or password is incorrect.");
        }
        if (user.getStatus() != AccountStatus.ACTIVE) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_UNAVAILABLE", "This account cannot sign in.");
        }
        return createSession(user, servletRequest);
    }

    @Transactional
    public IssuedSession refresh(String rawRefreshToken) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_TOKEN_REQUIRED", "A refresh token is required.");
        }
        AuthSession session = sessionRepository.findByRefreshTokenHashAndRevokedAtIsNull(tokens.sha256(rawRefreshToken))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "The refresh token is invalid."));
        Instant now = Instant.now();
        if (!session.refreshActive(now) || session.getUser().getStatus() != AccountStatus.ACTIVE) {
            session.revoke();
            throw new ApiException(HttpStatus.UNAUTHORIZED, "REFRESH_TOKEN_EXPIRED", "The refresh token has expired.");
        }
        String access = tokens.opaque("ccc_at_", 32);
        String refresh = tokens.opaque("ccc_rt_", 40);
        String csrf = tokens.opaque("csrf_", 24);
        Instant accessExpiry = now.plus(properties.accessTokenTtl());
        Instant refreshExpiry = now.plus(properties.refreshTokenTtl());
        session.rotate(tokens.sha256(access), tokens.sha256(refresh), tokens.sha256(csrf), accessExpiry, refreshExpiry);
        return new IssuedSession(session, access, refresh, csrf, accessExpiry, refreshExpiry);
    }

    @Transactional
    public void logout(UUID sessionId) {
        sessionRepository.findById(sessionId).ifPresent(AuthSession::revoke);
    }

    @Transactional(readOnly = true)
    public UserAccount requireUser(UUID userId) {
        return userRepository.findById(userId)
                .filter(user -> user.getStatus() == AccountStatus.ACTIVE)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "ACCOUNT_UNAVAILABLE", "The account is unavailable."));
    }

    private IssuedSession createSession(UserAccount user, HttpServletRequest request) {
        List<AuthSession> active = sessionRepository.findByUserIdAndRevokedAtIsNullOrderByCreatedAtAsc(user.getId());
        int sessionsToRevoke = active.size() - properties.maxSessionsPerUser() + 1;
        for (int index = 0; index < sessionsToRevoke; index++) active.get(index).revoke();

        Instant now = Instant.now();
        String access = tokens.opaque("ccc_at_", 32);
        String refresh = tokens.opaque("ccc_rt_", 40);
        String csrf = tokens.opaque("csrf_", 24);
        Instant accessExpiry = now.plus(properties.accessTokenTtl());
        Instant refreshExpiry = now.plus(properties.refreshTokenTtl());
        AuthSession session = sessionRepository.save(new AuthSession(
                user,
                tokens.sha256(access),
                tokens.sha256(refresh),
                tokens.sha256(csrf),
                accessExpiry,
                refreshExpiry,
                safeUserAgent(request.getHeader("User-Agent")),
                null));
        return new IssuedSession(session, access, refresh, csrf, accessExpiry, refreshExpiry);
    }

    private static String normalizeEmail(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private static String registrationDisplayName(String requestedName, String email) {
        if (requestedName != null && !requestedName.isBlank()) return requestedName.trim();
        String localPart = email.substring(0, email.indexOf('@')).trim();
        if (localPart.length() >= 2) return localPart.substring(0, Math.min(localPart.length(), 80));
        return "User";
    }

    private static void ensurePasswordFitsEncoder(String password) {
        if (password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_LONG", "The password must not exceed 72 UTF-8 bytes.");
        }
    }

    private static String safeUserAgent(String value) {
        if (value == null) return null;
        String singleLine = value
                .replace("\r", "")
                .replace("\n", "")
                .replace("\u0000", "")
                .trim();
        return singleLine.substring(0, Math.min(singleLine.length(), 512));
    }
}

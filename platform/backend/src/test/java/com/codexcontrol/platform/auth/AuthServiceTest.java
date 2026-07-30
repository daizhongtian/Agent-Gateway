package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.legal.LegalVersions;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthServiceTest {
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final AuthSessionRepository sessions = mock(AuthSessionRepository.class);
    private final DesktopAuthorizationCodeRepository desktopCodes = mock(DesktopAuthorizationCodeRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
    private final CryptoTokens tokens = mock(CryptoTokens.class);
    private final HttpServletRequest request = mock(HttpServletRequest.class);
    private AuthService service;

    @BeforeEach
    void setUp() {
        when(passwordEncoder.encode(anyString())).thenReturn("encoded-password");
        when(tokens.opaque(anyString(), anyInt())).thenAnswer(invocation -> invocation.getArgument(0) + "token");
        when(tokens.sha256(anyString())).thenAnswer(invocation -> "hash:" + invocation.getArgument(0));
        when(sessions.findByUserIdAndRevokedAtIsNullOrderByCreatedAtAsc(any())).thenReturn(List.of());
        when(sessions.save(any(AuthSession.class))).thenAnswer(invocation -> invocation.getArgument(0));
        service = new AuthService(users, sessions, desktopCodes, passwordEncoder, tokens, properties(true, 2));
    }

    @Test
    void registerRequiresCurrentConsentAndRejectsDuplicateOrOversizedPasswords() {
        AuthDtos.RegisterRequest missingConsent = register("owner@example.com", "a-secure-password", null, false, "old");
        assertApiCode(() -> service.register(missingConsent, request), "LEGAL_CONSENT_REQUIRED");

        AuthDtos.RegisterRequest oversized = register("owner@example.com", "密码".repeat(25), null, true, LegalVersions.PLATFORM_TERMS);
        assertApiCode(() -> service.register(oversized, request), "PASSWORD_TOO_LONG");

        when(users.existsByUsernameIgnoreCase("owner")).thenReturn(true);
        AuthDtos.RegisterRequest duplicate = register(" Owner@Example.com ", "a-secure-password", null, true, LegalVersions.PLATFORM_TERMS);
        assertApiCode(() -> service.register(duplicate, request), "USERNAME_ALREADY_REGISTERED");

        when(users.existsByUsernameIgnoreCase("owner")).thenReturn(false);
        when(users.existsByEmailIgnoreCase("owner@example.com")).thenReturn(true);
        assertApiCode(() -> service.register(duplicate, request), "EMAIL_ALREADY_REGISTERED");
    }

    @Test
    void registerNormalizesIdentityAndSanitizesUserAgent() {
        when(users.existsByEmailIgnoreCase(anyString())).thenReturn(false);
        when(users.save(any(UserAccount.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(request.getHeader("User-Agent")).thenReturn(" Agent\r\nGateway\u0000 ");

        IssuedSession issued = service.register(
                register(" Owner@Example.com ", "a-secure-password", "  Gateway Owner  ", true, LegalVersions.PLATFORM_TERMS),
                request);

        ArgumentCaptor<UserAccount> userCaptor = ArgumentCaptor.forClass(UserAccount.class);
        verify(users).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getUsername()).isEqualTo("owner");
        assertThat(userCaptor.getValue().getEmail()).isEqualTo("owner@example.com");
        assertThat(userCaptor.getValue().getDisplayName()).isEqualTo("Gateway Owner");
        assertThat(issued.session()).isNotNull();

        ArgumentCaptor<AuthSession> sessionCaptor = ArgumentCaptor.forClass(AuthSession.class);
        verify(sessions).save(sessionCaptor.capture());
        assertThat(issued.accessToken()).startsWith("ccc_at_");
        assertThat(issued.refreshToken()).startsWith("ccc_rt_");
        assertThat(issued.csrfToken()).startsWith("csrf_");
    }

    @Test
    void registerUsesSafeDisplayNameFallbacksAndOptionalConsentConfiguration() {
        AuthService optionalConsent = new AuthService(users, sessions, desktopCodes, passwordEncoder, tokens, properties(false, 2));
        when(users.existsByEmailIgnoreCase(anyString())).thenReturn(false);
        when(users.save(any(UserAccount.class))).thenAnswer(invocation -> invocation.getArgument(0));

        optionalConsent.register(new AuthDtos.RegisterRequest(
                "no-email", null, "a-secure-password", null, "desktop", false, null), request);
        optionalConsent.register(new AuthDtos.RegisterRequest(
                "fallback-user", "fallback@example.com", "a-secure-password", " ", "desktop", false, null), request);

        ArgumentCaptor<UserAccount> usersCaptor = ArgumentCaptor.forClass(UserAccount.class);
        verify(users, org.mockito.Mockito.times(2)).save(usersCaptor.capture());
        assertThat(usersCaptor.getAllValues().get(0).getEmail()).isNull();
        assertThat(usersCaptor.getAllValues().get(0).getDisplayName()).isEqualTo("no-email");
        assertThat(usersCaptor.getAllValues().get(1).getDisplayName()).isEqualTo("fallback-user");
    }

    @Test
    void loginUsesAConstantTimeDummyHashAndRejectsDisabledAccounts() {
        AuthDtos.LoginRequest login = login("owner@example.com", "a-secure-password");
        when(users.findByUsernameIgnoreCase("owner")).thenReturn(Optional.empty());
        assertApiCode(() -> service.login(login, request), "INVALID_CREDENTIALS");
        verify(passwordEncoder).matches("a-secure-password", "encoded-password");

        UserAccount user = new UserAccount("owner@example.com", "stored-hash", "Owner");
        when(users.findByUsernameIgnoreCase("owner")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("a-secure-password", "stored-hash")).thenReturn(false);
        assertApiCode(() -> service.login(login, request), "INVALID_CREDENTIALS");

        when(passwordEncoder.matches("a-secure-password", "stored-hash")).thenReturn(true);
        user.disable();
        assertApiCode(() -> service.login(login, request), "ACCOUNT_UNAVAILABLE");
    }

    @Test
    void loginRevokesOldestSessionsWhenThePerUserLimitIsReached() {
        UserAccount user = new UserAccount("owner@example.com", "stored-hash", "Owner");
        when(users.findByUsernameIgnoreCase("owner")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("a-secure-password", "stored-hash")).thenReturn(true);
        AuthSession oldest = session(user, Instant.now().plusSeconds(600));
        AuthSession newest = session(user, Instant.now().plusSeconds(600));
        when(sessions.findByUserIdAndRevokedAtIsNullOrderByCreatedAtAsc(any())).thenReturn(List.of(oldest, newest));

        IssuedSession issued = service.login(login("owner@example.com", "a-secure-password"), request);

        assertThat(oldest.getRevokedAt()).isNotNull();
        assertThat(newest.getRevokedAt()).isNull();
        assertThat(issued.session().getUser()).isSameAs(user);
    }

    @Test
    void refreshRejectsMissingInvalidExpiredAndDisabledSessionsThenRotatesAValidSession() {
        assertApiCode(() -> service.refresh(" "), "REFRESH_TOKEN_REQUIRED");
        when(sessions.findByRefreshTokenHashAndRevokedAtIsNull("hash:missing")).thenReturn(Optional.empty());
        assertApiCode(() -> service.refresh("missing"), "INVALID_REFRESH_TOKEN");

        UserAccount activeUser = new UserAccount("owner@example.com", "hash", "Owner");
        AuthSession expired = session(activeUser, Instant.now().minusSeconds(1));
        when(sessions.findByRefreshTokenHashAndRevokedAtIsNull("hash:expired")).thenReturn(Optional.of(expired));
        assertApiCode(() -> service.refresh("expired"), "REFRESH_TOKEN_EXPIRED");
        assertThat(expired.getRevokedAt()).isNotNull();

        UserAccount disabledUser = new UserAccount("disabled@example.com", "hash", "Disabled");
        disabledUser.disable();
        AuthSession disabled = session(disabledUser, Instant.now().plusSeconds(600));
        when(sessions.findByRefreshTokenHashAndRevokedAtIsNull("hash:disabled")).thenReturn(Optional.of(disabled));
        assertApiCode(() -> service.refresh("disabled"), "REFRESH_TOKEN_EXPIRED");

        AuthSession valid = session(activeUser, Instant.now().plusSeconds(600));
        when(sessions.findByRefreshTokenHashAndRevokedAtIsNull("hash:valid")).thenReturn(Optional.of(valid));
        IssuedSession issued = service.refresh("valid");
        assertThat(issued.session()).isSameAs(valid);
        assertThat(valid.getCsrfTokenHash()).isEqualTo("hash:csrf_token");
    }

    @Test
    void desktopAuthorizationRejectsInvalidExpiredVerifierAndDisabledAccount() {
        AuthDtos.DesktopExchangeRequest exchange = new AuthDtos.DesktopExchangeRequest("code", "v".repeat(43));
        when(desktopCodes.findByCodeHashAndConsumedAtIsNull("hash:code")).thenReturn(Optional.empty());
        assertApiCode(() -> service.exchangeDesktopAuthorization(exchange, request), "INVALID_DESKTOP_AUTHORIZATION");

        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        DesktopAuthorizationCode expired = new DesktopAuthorizationCode(user, "hash:code", "challenge", Instant.now().minusSeconds(1));
        when(desktopCodes.findByCodeHashAndConsumedAtIsNull("hash:code")).thenReturn(Optional.of(expired));
        assertApiCode(() -> service.exchangeDesktopAuthorization(exchange, request), "DESKTOP_AUTHORIZATION_EXPIRED");

        DesktopAuthorizationCode active = new DesktopAuthorizationCode(user, "hash:code", "challenge", Instant.now().plusSeconds(60));
        when(desktopCodes.findByCodeHashAndConsumedAtIsNull("hash:code")).thenReturn(Optional.of(active));
        when(tokens.sha256Base64Url(exchange.codeVerifier())).thenReturn("wrong");
        when(tokens.matches("wrong", "hash:challenge")).thenReturn(false);
        assertApiCode(() -> service.exchangeDesktopAuthorization(exchange, request), "DESKTOP_AUTHORIZATION_VERIFIER_REJECTED");

        when(tokens.sha256Base64Url(exchange.codeVerifier())).thenReturn("challenge");
        when(tokens.matches("challenge", "hash:challenge")).thenReturn(true);
        user.disable();
        assertApiCode(() -> service.exchangeDesktopAuthorization(exchange, request), "ACCOUNT_UNAVAILABLE");
    }

    @Test
    void desktopAuthorizationCanBeIssuedExchangedAndLoggedOut() {
        UUID userId = UUID.randomUUID();
        UserAccount user = new UserAccount("owner@example.com", "hash", "Owner");
        when(users.findById(userId)).thenReturn(Optional.of(user));
        DesktopAuthorizationIssue issue = service.authorizeDesktop(userId, "challenge");
        assertThat(issue.code()).startsWith("ccc_dac_");
        verify(desktopCodes).save(any(DesktopAuthorizationCode.class));

        AuthDtos.DesktopExchangeRequest exchange = new AuthDtos.DesktopExchangeRequest(issue.code(), "v".repeat(43));
        DesktopAuthorizationCode code = new DesktopAuthorizationCode(user, "hash:" + issue.code(), "challenge", Instant.now().plusSeconds(60));
        when(desktopCodes.findByCodeHashAndConsumedAtIsNull("hash:" + issue.code())).thenReturn(Optional.of(code));
        when(tokens.sha256Base64Url(exchange.codeVerifier())).thenReturn("challenge");
        when(tokens.matches("challenge", "hash:challenge")).thenReturn(true);
        assertThat(service.exchangeDesktopAuthorization(exchange, request).session()).isNotNull();

        UUID sessionId = UUID.randomUUID();
        AuthSession session = session(user, Instant.now().plusSeconds(600));
        when(sessions.findById(sessionId)).thenReturn(Optional.of(session));
        service.logout(sessionId);
        assertThat(session.getRevokedAt()).isNotNull();
        service.logout(UUID.randomUUID());
    }

    @Test
    void requireUserRejectsMissingAndDisabledAccounts() {
        UUID userId = UUID.randomUUID();
        when(users.findById(userId)).thenReturn(Optional.empty());
        assertApiCode(() -> service.requireUser(userId), "ACCOUNT_UNAVAILABLE");

        UserAccount disabled = new UserAccount("owner@example.com", "hash", "Owner");
        disabled.disable();
        when(users.findById(userId)).thenReturn(Optional.of(disabled));
        assertApiCode(() -> service.requireUser(userId), "ACCOUNT_UNAVAILABLE");

        when(users.findByIdForUpdate(userId)).thenReturn(Optional.empty());
        assertApiCode(() -> service.lockActiveUser(userId), "ACCOUNT_UNAVAILABLE");
        when(users.findByIdForUpdate(userId)).thenReturn(Optional.of(disabled));
        assertApiCode(() -> service.lockActiveUser(userId), "ACCOUNT_UNAVAILABLE");
        UserAccount active = new UserAccount("active@example.com", "hash", "Active");
        when(users.findByIdForUpdate(userId)).thenReturn(Optional.of(active));
        assertThat(service.lockActiveUser(userId)).isSameAs(active);
    }

    private static AuthDtos.RegisterRequest register(
            String email, String password, String displayName, Boolean accepted, String version) {
        String username = email.substring(0, email.indexOf('@')).trim().toLowerCase(java.util.Locale.ROOT);
        return new AuthDtos.RegisterRequest(username, email, password, displayName, "desktop", accepted, version);
    }

    private static AuthDtos.LoginRequest login(String email, String password) {
        String username = email.substring(0, email.indexOf('@')).trim().toLowerCase(java.util.Locale.ROOT);
        return new AuthDtos.LoginRequest(username, password, "desktop", true, LegalVersions.PLATFORM_TERMS);
    }

    private static AuthSession session(UserAccount user, Instant refreshExpiresAt) {
        return new AuthSession(
                user, "access-hash", "refresh-hash", "csrf-hash",
                Instant.now().plusSeconds(60), refreshExpiresAt, null, null);
    }

    private static PlatformProperties properties(boolean legalConsentRequired, int maxSessions) {
        return new PlatformProperties(
                null, null, null, null, false, true, null, false,
                Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofMinutes(10),
                maxSessions, 10, 10, legalConsentRequired);
    }

    private static void assertApiCode(Runnable action, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo(code);
    }
}

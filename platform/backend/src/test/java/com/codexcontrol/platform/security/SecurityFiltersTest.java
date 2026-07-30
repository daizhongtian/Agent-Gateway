package com.codexcontrol.platform.security;

import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.auth.AuthRequestAttributes;
import com.codexcontrol.platform.auth.AuthSession;
import com.codexcontrol.platform.auth.AuthSessionRepository;
import com.codexcontrol.platform.auth.AuthenticationSource;
import com.codexcontrol.platform.auth.CookieSupport;
import com.codexcontrol.platform.common.CryptoTokens;
import com.codexcontrol.platform.common.RequestIdFilter;
import com.codexcontrol.platform.config.PlatformProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SecurityFiltersTest {
    private final AuthSessionRepository sessions = mock(AuthSessionRepository.class);
    private final CookieSupport cookies = mock(CookieSupport.class);
    private final CryptoTokens tokens = mock(CryptoTokens.class);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void accessFilterIgnoresMissingInvalidAndOversizedBearerTokens() throws Exception {
        AccessTokenAuthenticationFilter filter = new AccessTokenAuthenticationFilter(sessions, cookies, tokens);
        for (String authorization : new String[]{null, "Basic abc", "Bearer   ", "Bearer " + "x".repeat(257)}) {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/account");
            if (authorization != null) request.addHeader("Authorization", authorization);
            MockHttpServletResponse response = new MockHttpServletResponse();
            FilterChain chain = mock(FilterChain.class);
            when(cookies.read(request, CookieSupport.ACCESS_COOKIE)).thenReturn(null);

            filter.doFilter(request, response, chain);

            verify(chain).doFilter(request, response);
            assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        }
        verify(sessions, never()).findByAccessTokenHashAndRevokedAtIsNull(any());
    }

    @Test
    void accessFilterAuthenticatesBearerAndCookieSessionsButPreservesExistingAuthentication() throws Exception {
        AccessTokenAuthenticationFilter filter = new AccessTokenAuthenticationFilter(sessions, cookies, tokens);
        UserAccount user = mock(UserAccount.class);
        AuthSession session = mock(AuthSession.class);
        when(user.getId()).thenReturn(UUID.randomUUID());
        when(user.getStatus()).thenReturn(AccountStatus.ACTIVE);
        when(user.getEmail()).thenReturn("owner@example.com");
        when(user.getDisplayName()).thenReturn("Owner");
        when(session.getId()).thenReturn(UUID.randomUUID());
        when(session.getUser()).thenReturn(user);
        when(session.getAccessExpiresAt()).thenReturn(Instant.now().plusSeconds(60));
        when(session.accessActive(any())).thenReturn(true);
        when(tokens.sha256("bearer-token")).thenReturn("bearer-hash");
        when(tokens.sha256("cookie-token")).thenReturn("cookie-hash");
        when(sessions.findByAccessTokenHashAndRevokedAtIsNull("bearer-hash")).thenReturn(Optional.of(session));
        when(sessions.findByAccessTokenHashAndRevokedAtIsNull("cookie-hash")).thenReturn(Optional.of(session));

        MockHttpServletRequest bearer = new MockHttpServletRequest("GET", "/api/v1/account");
        bearer.addHeader("Authorization", "bEaReR bearer-token");
        filter.doFilter(bearer, new MockHttpServletResponse(), mock(FilterChain.class));
        assertThat(bearer.getAttribute(AuthRequestAttributes.SOURCE)).isEqualTo(AuthenticationSource.BEARER);
        assertThat(SecurityContextHolder.getContext().getAuthentication().isAuthenticated()).isTrue();

        SecurityContextHolder.clearContext();
        MockHttpServletRequest cookie = new MockHttpServletRequest("GET", "/api/v1/account");
        when(cookies.read(cookie, CookieSupport.ACCESS_COOKIE)).thenReturn("cookie-token");
        filter.doFilter(cookie, new MockHttpServletResponse(), mock(FilterChain.class));
        assertThat(cookie.getAttribute(AuthRequestAttributes.SOURCE)).isEqualTo(AuthenticationSource.COOKIE);

        var existing = UsernamePasswordAuthenticationToken.authenticated("existing", null, java.util.List.of());
        SecurityContextHolder.getContext().setAuthentication(existing);
        MockHttpServletRequest alreadyAuthenticated = new MockHttpServletRequest("GET", "/api/v1/account");
        alreadyAuthenticated.addHeader("Authorization", "Bearer unused-token");
        filter.doFilter(alreadyAuthenticated, new MockHttpServletResponse(), mock(FilterChain.class));
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isSameAs(existing);
    }

    @Test
    void accessFilterRejectsExpiredAndDisabledAccountSessions() throws Exception {
        AccessTokenAuthenticationFilter filter = new AccessTokenAuthenticationFilter(sessions, cookies, tokens);
        UserAccount user = mock(UserAccount.class);
        AuthSession session = mock(AuthSession.class);
        when(session.getUser()).thenReturn(user);
        when(tokens.sha256("token")).thenReturn("hash");
        when(sessions.findByAccessTokenHashAndRevokedAtIsNull("hash")).thenReturn(Optional.of(session));

        MockHttpServletRequest expired = new MockHttpServletRequest("GET", "/api/v1/account");
        expired.addHeader("Authorization", "Bearer token");
        when(session.accessActive(any())).thenReturn(false);
        filter.doFilter(expired, new MockHttpServletResponse(), mock(FilterChain.class));
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();

        MockHttpServletRequest disabled = new MockHttpServletRequest("GET", "/api/v1/account");
        disabled.addHeader("Authorization", "Bearer token");
        when(session.accessActive(any())).thenReturn(true);
        when(user.getStatus()).thenReturn(AccountStatus.DISABLED);
        filter.doFilter(disabled, new MockHttpServletResponse(), mock(FilterChain.class));
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void csrfFilterAllowsSafeAndBearerRequestsAndRequiresMatchingCookieTokens() throws Exception {
        FilterErrorWriter errors = mock(FilterErrorWriter.class);
        CsrfProtectionFilter filter = new CsrfProtectionFilter(cookies, tokens, errors);

        MockHttpServletRequest safe = new MockHttpServletRequest("GET", "/api/v1/account");
        safe.setAttribute(AuthRequestAttributes.SOURCE, AuthenticationSource.COOKIE);
        FilterChain safeChain = mock(FilterChain.class);
        filter.doFilter(safe, new MockHttpServletResponse(), safeChain);
        verify(safeChain).doFilter(any(), any());

        MockHttpServletRequest bearer = new MockHttpServletRequest("POST", "/api/v1/account");
        bearer.setAttribute(AuthRequestAttributes.SOURCE, AuthenticationSource.BEARER);
        FilterChain bearerChain = mock(FilterChain.class);
        filter.doFilter(bearer, new MockHttpServletResponse(), bearerChain);
        verify(bearerChain).doFilter(any(), any());

        AuthSession session = mock(AuthSession.class);
        when(session.getCsrfTokenHash()).thenReturn("csrf-hash");
        MockHttpServletRequest valid = csrfRequest(session, "csrf-token", "csrf-token");
        when(cookies.read(valid, CookieSupport.CSRF_COOKIE)).thenReturn("csrf-token");
        when(tokens.matches("csrf-token", "csrf-hash")).thenReturn(true);
        FilterChain validChain = mock(FilterChain.class);
        filter.doFilter(valid, new MockHttpServletResponse(), validChain);
        verify(validChain).doFilter(any(), any());
    }

    @Test
    void csrfFilterRejectsEveryMissingOrMismatchedCredentialCombination() throws Exception {
        FilterErrorWriter errors = mock(FilterErrorWriter.class);
        CsrfProtectionFilter filter = new CsrfProtectionFilter(cookies, tokens, errors);
        AuthSession session = mock(AuthSession.class);
        when(session.getCsrfTokenHash()).thenReturn("csrf-hash");

        MockHttpServletRequest[] rejected = new MockHttpServletRequest[]{
                csrfRequest(null, null, null),
                csrfRequest(session, null, "token"),
                csrfRequest(session, "token", null),
                csrfRequest(session, "cookie", "header"),
                csrfRequest(session, "same", "same")
        };
        for (MockHttpServletRequest request : rejected) {
            String cookie = request.getCookies() == null ? null : request.getCookies()[0].getValue();
            when(cookies.read(request, CookieSupport.CSRF_COOKIE)).thenReturn(cookie);
            if ("same".equals(cookie)) when(tokens.matches("same", "csrf-hash")).thenReturn(false);
            FilterChain chain = mock(FilterChain.class);
            filter.doFilter(request, new MockHttpServletResponse(), chain);
            verify(chain, never()).doFilter(any(), any());
        }
        verify(errors, times(rejected.length)).write(any(), any(), org.mockito.ArgumentMatchers.eq(403),
                org.mockito.ArgumentMatchers.eq("CSRF_REJECTED"), any());
    }

    @Test
    void sensitiveEndpointFilterSkipsOtherTrafficAndLimitsRepeatedLoginAttempts() throws Exception {
        FilterErrorWriter errors = mock(FilterErrorWriter.class);
        SensitiveEndpointRateLimitFilter filter = new SensitiveEndpointRateLimitFilter(errors);

        for (MockHttpServletRequest request : new MockHttpServletRequest[]{
                new MockHttpServletRequest("GET", "/api/v1/auth/login"),
                new MockHttpServletRequest("POST", "/api/v1/hosts")
        }) {
            FilterChain chain = mock(FilterChain.class);
            filter.doFilter(request, new MockHttpServletResponse(), chain);
            verify(chain).doFilter(any(), any());
        }

        for (int attempt = 1; attempt <= 21; attempt++) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
            request.setRemoteAddr("203.0.113.20");
            MockHttpServletResponse response = new MockHttpServletResponse();
            FilterChain chain = mock(FilterChain.class);
            filter.doFilter(request, response, chain);
            if (attempt <= 20) verify(chain).doFilter(any(), any());
            else {
                verify(chain, never()).doFilter(any(), any());
                assertThat(response.getHeader("Retry-After")).isNotBlank();
            }
        }
        verify(errors).write(any(), any(), org.mockito.ArgumentMatchers.eq(429),
                org.mockito.ArgumentMatchers.eq("RATE_LIMITED"), any());
    }

    @Test
    void filterErrorWriterIncludesOnlyStringRequestIds() throws Exception {
        FilterErrorWriter writer = new FilterErrorWriter(new ObjectMapper());
        MockHttpServletRequest withId = new MockHttpServletRequest();
        withId.setAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE, "req_test");
        MockHttpServletResponse first = new MockHttpServletResponse();
        writer.write(withId, first, 401, "INVALID", "Invalid request");
        assertThat(first.getContentAsString()).contains("req_test");

        MockHttpServletRequest withoutStringId = new MockHttpServletRequest();
        withoutStringId.setAttribute(RequestIdFilter.REQUEST_ID_ATTRIBUTE, 123);
        MockHttpServletResponse second = new MockHttpServletResponse();
        writer.write(withoutStringId, second, 403, "FORBIDDEN", "Forbidden");
        assertThat(second.getContentAsString()).contains("FORBIDDEN").doesNotContain("req_test");
    }

    @Test
    void securityConfigurationBuildsPasswordAndCorsPoliciesFromPlatformSettings() {
        SecurityConfiguration configuration = new SecurityConfiguration();
        assertThat(configuration.passwordEncoder().matches(
                "correct horse battery staple",
                configuration.passwordEncoder().encode("correct horse battery staple"))).isTrue();

        PlatformProperties properties = new PlatformProperties(
                "https://app.example.com", null, null, null, false, false, null, true,
                Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofMinutes(10), 10, 10, 10, true);
        var source = configuration.corsConfigurationSource(properties);
        var cors = source.getCorsConfiguration(new MockHttpServletRequest("GET", "/api/v1/account"));
        assertThat(cors).isNotNull();
        assertThat(cors.getAllowedOrigins()).containsExactly("https://app.example.com");
        assertThat(cors.getAllowedMethods()).contains("GET", "POST", "PATCH", "DELETE", "OPTIONS");
        assertThat(cors.getAllowCredentials()).isTrue();
    }

    @Test
    void securityConfigurationWritesStableAuthenticationAndAuthorizationErrors() throws Exception {
        SecurityConfiguration configuration = new SecurityConfiguration();
        FilterErrorWriter errors = mock(FilterErrorWriter.class);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/account");
        MockHttpServletResponse response = new MockHttpServletResponse();

        configuration.authenticationEntryPoint(errors).commence(request, response, null);
        verify(errors).write(request, response, 401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");

        configuration.accessDeniedHandler(errors).handle(request, response, null);
        verify(errors).write(request, response, 403, "ACCESS_DENIED",
                "You do not have permission to perform this action.");
    }

    private static MockHttpServletRequest csrfRequest(AuthSession session, String cookie, String header) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/account");
        request.setAttribute(AuthRequestAttributes.SOURCE, AuthenticationSource.COOKIE);
        if (session != null) request.setAttribute(AuthRequestAttributes.SESSION, session);
        if (cookie != null) request.setCookies(new Cookie(CookieSupport.CSRF_COOKIE, cookie));
        if (header != null) request.addHeader("X-CSRF-Token", header);
        return request;
    }
}

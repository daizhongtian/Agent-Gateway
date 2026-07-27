package com.codexcontrol.platform.security;

import com.codexcontrol.platform.account.AccountStatus;
import com.codexcontrol.platform.auth.AuthRequestAttributes;
import com.codexcontrol.platform.auth.AuthSession;
import com.codexcontrol.platform.auth.AuthSessionRepository;
import com.codexcontrol.platform.auth.AuthenticationSource;
import com.codexcontrol.platform.auth.CookieSupport;
import com.codexcontrol.platform.auth.PlatformPrincipal;
import com.codexcontrol.platform.common.CryptoTokens;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;

@Component
public class AccessTokenAuthenticationFilter extends OncePerRequestFilter {
    private final AuthSessionRepository sessionRepository;
    private final CookieSupport cookies;
    private final CryptoTokens tokens;

    public AccessTokenAuthenticationFilter(
            AuthSessionRepository sessionRepository,
            CookieSupport cookies,
            CryptoTokens tokens
    ) {
        this.sessionRepository = sessionRepository;
        this.cookies = cookies;
        this.tokens = tokens;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        ResolvedToken resolved = resolve(request);
        if (resolved != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            AuthSession session = sessionRepository
                    .findByAccessTokenHashAndRevokedAtIsNull(tokens.sha256(resolved.token()))
                    .filter(candidate -> candidate.accessActive(Instant.now()))
                    .filter(candidate -> candidate.getUser().getStatus() == AccountStatus.ACTIVE)
                    .orElse(null);
            if (session != null) {
                PlatformPrincipal principal = new PlatformPrincipal(
                        session.getUser().getId(),
                        session.getId(),
                        session.getUser().getEmail(),
                        session.getUser().getDisplayName(),
                        session.getAccessExpiresAt());
                var authentication = new UsernamePasswordAuthenticationToken(
                        principal,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_USER")));
                SecurityContextHolder.getContext().setAuthentication(authentication);
                request.setAttribute(AuthRequestAttributes.SESSION, session);
                request.setAttribute(AuthRequestAttributes.SOURCE, resolved.source());
            }
        }
        filterChain.doFilter(request, response);
    }

    private ResolvedToken resolve(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            String token = authorization.substring(7).trim();
            if (!token.isBlank() && token.length() <= 256) return new ResolvedToken(token, AuthenticationSource.BEARER);
        }
        String cookie = cookies.read(request, CookieSupport.ACCESS_COOKIE);
        return cookie == null || cookie.isBlank() ? null : new ResolvedToken(cookie, AuthenticationSource.COOKIE);
    }

    private record ResolvedToken(String token, AuthenticationSource source) {
    }
}

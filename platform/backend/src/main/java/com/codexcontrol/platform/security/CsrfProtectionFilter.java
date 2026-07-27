package com.codexcontrol.platform.security;

import com.codexcontrol.platform.auth.AuthRequestAttributes;
import com.codexcontrol.platform.auth.AuthSession;
import com.codexcontrol.platform.auth.AuthenticationSource;
import com.codexcontrol.platform.auth.CookieSupport;
import com.codexcontrol.platform.common.CryptoTokens;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;

@Component
public class CsrfProtectionFilter extends OncePerRequestFilter {
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");
    private final CookieSupport cookies;
    private final CryptoTokens tokens;
    private final FilterErrorWriter errors;

    public CsrfProtectionFilter(CookieSupport cookies, CryptoTokens tokens, FilterErrorWriter errors) {
        this.cookies = cookies;
        this.tokens = tokens;
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        Object source = request.getAttribute(AuthRequestAttributes.SOURCE);
        if (!SAFE_METHODS.contains(request.getMethod()) && source == AuthenticationSource.COOKIE) {
            AuthSession session = (AuthSession) request.getAttribute(AuthRequestAttributes.SESSION);
            String cookie = cookies.read(request, CookieSupport.CSRF_COOKIE);
            String header = request.getHeader("X-CSRF-Token");
            boolean valid = session != null
                    && cookie != null
                    && header != null
                    && cookie.equals(header)
                    && tokens.matches(header, session.getCsrfTokenHash());
            if (!valid) {
                errors.write(request, response, 403, "CSRF_REJECTED", "The CSRF token is missing or invalid.");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}

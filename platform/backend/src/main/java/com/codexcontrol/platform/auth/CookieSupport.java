package com.codexcontrol.platform.auth;

import com.codexcontrol.platform.config.PlatformProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Arrays;

@Component
public class CookieSupport {
    public static final String ACCESS_COOKIE = "ccc_platform_access";
    public static final String REFRESH_COOKIE = "ccc_platform_refresh";
    public static final String CSRF_COOKIE = "ccc_platform_csrf";

    private final PlatformProperties properties;

    public CookieSupport(PlatformProperties properties) {
        this.properties = properties;
    }

    public String read(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        return Arrays.stream(cookies)
                .filter(cookie -> name.equals(cookie.getName()))
                .map(Cookie::getValue)
                .findFirst()
                .orElse(null);
    }

    public void writeSession(HttpServletResponse response, IssuedSession issued) {
        add(response, ACCESS_COOKIE, issued.accessToken(), properties.accessTokenTtl(), "/api", true);
        add(response, REFRESH_COOKIE, issued.refreshToken(), properties.refreshTokenTtl(), "/api/v1/auth", true);
        add(response, CSRF_COOKIE, issued.csrfToken(), properties.refreshTokenTtl(), "/", false);
    }

    public void clearSession(HttpServletResponse response) {
        add(response, ACCESS_COOKIE, "", Duration.ZERO, "/api", true);
        add(response, REFRESH_COOKIE, "", Duration.ZERO, "/api/v1/auth", true);
        add(response, CSRF_COOKIE, "", Duration.ZERO, "/", false);
    }

    private void add(
            HttpServletResponse response,
            String name,
            String value,
            Duration maxAge,
            String path,
            boolean httpOnly
    ) {
        ResponseCookie cookie = ResponseCookie.from(name, value)
                .httpOnly(httpOnly)
                .secure(properties.secureCookies())
                .sameSite("Strict")
                .path(path)
                .maxAge(maxAge)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}

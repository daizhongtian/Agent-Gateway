package com.codexcontrol.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class SensitiveEndpointRateLimitFilter extends OncePerRequestFilter {
    private static final Duration WINDOW = Duration.ofMinutes(5);
    private static final Map<String, Integer> LIMITS = Map.of(
            "/api/v1/auth/register", 10,
            "/api/v1/auth/login", 20,
            "/api/v1/auth/refresh", 60,
            "/api/v1/auth/desktop/authorize", 60,
            "/api/v1/auth/desktop/exchange", 40,
            "/api/v1/desktop/pair", 30,
            "/api/v1/desktop/tunnel-token", 120);

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final AtomicLong requests = new AtomicLong();
    private final FilterErrorWriter errors;

    public SensitiveEndpointRateLimitFilter(FilterErrorWriter errors) {
        this.errors = errors;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || !LIMITS.containsKey(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        Instant now = Instant.now();
        String key = request.getRequestURI() + ':' + request.getRemoteAddr();
        int limit = LIMITS.get(request.getRequestURI());
        Bucket bucket = buckets.compute(key, (_key, current) -> {
            if (current == null || current.startedAt().plus(WINDOW).isBefore(now)) return new Bucket(now, 1);
            return new Bucket(current.startedAt(), current.count() + 1);
        });
        if (requests.incrementAndGet() % 1024 == 0) {
            buckets.entrySet().removeIf(entry -> entry.getValue().startedAt().plus(WINDOW).isBefore(now));
        }
        if (bucket.count() > limit) {
            long retryAfter = Math.max(1, Duration.between(now, bucket.startedAt().plus(WINDOW)).toSeconds());
            response.setHeader("Retry-After", Long.toString(retryAfter));
            errors.write(request, response, 429, "RATE_LIMITED", "Too many attempts. Try again later.");
            return;
        }
        filterChain.doFilter(request, response);
    }

    private record Bucket(Instant startedAt, int count) {
    }
}

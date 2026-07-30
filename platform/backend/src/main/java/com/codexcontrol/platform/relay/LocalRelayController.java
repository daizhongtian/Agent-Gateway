package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.host.HostService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@RestController
public class LocalRelayController {
    private static final int MAX_REQUEST_BYTES = 36 * 1024 * 1024;
    private static final long MAX_RESPONSE_BYTES = 128L * 1024 * 1024;
    private static final Duration RELAY_DEADLINE = Duration.ofMinutes(31);
    private static final ScheduledExecutorService DEADLINES = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "relay-response-deadlines");
        thread.setDaemon(true);
        return thread;
    });
    private static final Set<String> FORWARDED_REQUEST_HEADERS = Set.of(
            "authorization",
            "content-type",
            "accept",
            "openai-beta",
            "openai-organization",
            "openai-project",
            "x-client-request-id");
    private static final List<String> FORWARDED_RESPONSE_HEADERS = List.of(
            "content-type", "cache-control", "x-request-id", "x-accel-buffering");

    private final HostService hostService;
    private final PlatformProperties properties;
    private final HttpClient httpClient;
    private final Semaphore admissions;

    public LocalRelayController(HostService hostService, PlatformProperties properties) {
        this.hostService = hostService;
        this.properties = properties;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                // The desktop Gateway also has a WebSocket upgrade handler.
                // Java's default h2c upgrade would be interpreted as a socket
                // upgrade and turn ordinary /v1 requests into a 404.
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        this.admissions = new Semaphore(32, true);
    }

    @GetMapping("/h/{slug}/v1/models")
    public ResponseEntity<StreamingResponseBody> models(
            @PathVariable String slug,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return proxy(slug, "/v1/models", "GET", request, response);
    }

    @GetMapping("/h/{slug}/health")
    public ResponseEntity<StreamingResponseBody> health(
            @PathVariable String slug,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return proxy(slug, "/api/v1/health", "GET", request, response);
    }

    @PostMapping("/h/{slug}/v1/responses")
    public ResponseEntity<StreamingResponseBody> responses(
            @PathVariable String slug,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return proxy(slug, "/v1/responses", "POST", request, response);
    }

    @PostMapping("/h/{slug}/v1/chat/completions")
    public ResponseEntity<StreamingResponseBody> chatCompletions(
            @PathVariable String slug,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return proxy(slug, "/v1/chat/completions", "POST", request, response);
    }

    private ResponseEntity<StreamingResponseBody> proxy(
            String slug,
            String path,
            String method,
            HttpServletRequest incoming,
            HttpServletResponse outgoing
    ) {
        hostService.requirePublicOnline(slug);
        if (incoming.getContentLengthLong() > MAX_REQUEST_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE", "The request body exceeds 36 MiB.");
        }
        if (!admissions.tryAcquire()) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RELAY_BUSY", "The local Relay is at its concurrent request limit.");
        }

        URI target = URI.create(properties.localGatewayBaseUrl() + path);
        final HttpRequest.BodyPublisher bodyPublisher;
        try {
            if ("GET".equals(method)) {
                bodyPublisher = HttpRequest.BodyPublishers.noBody();
            } else {
                InputStream body = incoming.getInputStream();
                AtomicBoolean claimed = new AtomicBoolean();
                bodyPublisher = HttpRequest.BodyPublishers.ofInputStream(() -> {
                    if (!claimed.compareAndSet(false, true)) return InputStream.nullInputStream();
                    return new BoundedInputStream(body, MAX_REQUEST_BYTES);
                });
            }
        } catch (IOException error) {
            admissions.release();
            throw new ApiException(HttpStatus.BAD_REQUEST, "REQUEST_BODY_UNREADABLE", "The request body could not be read.");
        }
        HttpRequest.Builder request = HttpRequest.newBuilder(target)
                .timeout(RELAY_DEADLINE)
                .header("User-Agent", "Agent-Gateway-Platform/3")
                .method(method, bodyPublisher);
        String localHostHeader = localGatewayHostHeader(target);
        if (localHostHeader != null) request.header("Host", localHostHeader);
        incoming.getHeaderNames().asIterator().forEachRemaining(name -> {
            if (FORWARDED_REQUEST_HEADERS.contains(name.toLowerCase(Locale.ROOT))) {
                incoming.getHeaders(name).asIterator().forEachRemaining(value -> request.header(name, value));
            }
        });

        final HttpResponse<InputStream> upstream;
        try {
            upstream = httpClient.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException error) {
            admissions.release();
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_GATEWAY_INTERRUPTED", "The local Gateway request was interrupted.");
        } catch (IOException | IllegalArgumentException error) {
            admissions.release();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_GATEWAY_UNREACHABLE", "The local Agent Gateway is not reachable.");
        }

        HttpHeaders responseHeaders = new HttpHeaders();
        FORWARDED_RESPONSE_HEADERS.forEach(name -> upstream.headers().allValues(name)
                .forEach(value -> responseHeaders.add(name, value)));
        if (upstream.headers().firstValue("content-type").orElse("").toLowerCase(Locale.ROOT)
                .startsWith("text/event-stream")) {
            responseHeaders.set("X-Accel-Buffering", "no");
        }
        StreamingResponseBody responseBody = output -> {
            var deadline = DEADLINES.schedule(() -> {
                try { upstream.body().close(); } catch (IOException ignored) { }
            }, RELAY_DEADLINE.toMillis(), TimeUnit.MILLISECONDS);
            try (InputStream input = upstream.body()) {
                byte[] buffer = new byte[16 * 1024];
                int count;
                long total = 0;
                while ((count = input.read(buffer)) >= 0) {
                    total += count;
                    if (total > MAX_RESPONSE_BYTES) throw new IOException("Relay response exceeded the byte limit.");
                    output.write(buffer, 0, count);
                    output.flush();
                    // StreamingResponseBody can sit behind the servlet
                    // container's own response buffer. Flush that boundary as
                    // well so an SSE event is observable before the next event
                    // or the end of the upstream response.
                    outgoing.flushBuffer();
                }
            } finally {
                deadline.cancel(false);
                admissions.release();
            }
        };
        return ResponseEntity.status(upstream.statusCode()).headers(responseHeaders).body(responseBody);
    }

    static String localGatewayHostHeader(URI target) {
        if (!"host.docker.internal".equalsIgnoreCase(target.getHost())) return null;
        int port = target.getPort() > 0 ? target.getPort() : 80;
        return "127.0.0.1:" + port;
    }

    static final class BoundedInputStream extends FilterInputStream {
        private long remaining;

        BoundedInputStream(InputStream input, long limit) {
            super(input);
            this.remaining = limit;
        }

        @Override
        public int read() throws IOException {
            if (remaining == 0) {
                if (super.read() < 0) return -1;
                throw new IOException("Relay request exceeded the byte limit.");
            }
            int value = super.read();
            if (value >= 0) remaining -= 1;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining == 0) {
                if (super.read() < 0) return -1;
                throw new IOException("Relay request exceeded the byte limit.");
            }
            int count = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (count >= 0) remaining -= count;
            return count;
        }
    }
}

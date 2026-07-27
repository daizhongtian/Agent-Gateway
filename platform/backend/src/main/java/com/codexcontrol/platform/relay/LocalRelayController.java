package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.host.HostService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@RestController
public class LocalRelayController {
    private static final int MAX_REQUEST_BYTES = 128 * 1024 * 1024;
    private static final Set<String> FORWARDED_REQUEST_HEADERS = Set.of(
            "authorization",
            "content-type",
            "accept",
            "openai-beta",
            "openai-organization",
            "openai-project",
            "x-client-request-id");
    private static final List<String> FORWARDED_RESPONSE_HEADERS = List.of(
            "content-type", "cache-control", "x-request-id");

    private final HostService hostService;
    private final PlatformProperties properties;
    private final HttpClient httpClient;

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
    }

    @GetMapping("/h/{slug}/v1/models")
    public ResponseEntity<StreamingResponseBody> models(
            @PathVariable String slug,
            HttpServletRequest request
    ) {
        return proxy(slug, "/v1/models", "GET", null, request);
    }

    @PostMapping("/h/{slug}/v1/responses")
    public ResponseEntity<StreamingResponseBody> responses(
            @PathVariable String slug,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request
    ) {
        return proxy(slug, "/v1/responses", "POST", body, request);
    }

    @PostMapping("/h/{slug}/v1/chat/completions")
    public ResponseEntity<StreamingResponseBody> chatCompletions(
            @PathVariable String slug,
            @RequestBody(required = false) byte[] body,
            HttpServletRequest request
    ) {
        return proxy(slug, "/v1/chat/completions", "POST", body, request);
    }

    private ResponseEntity<StreamingResponseBody> proxy(
            String slug,
            String path,
            String method,
            byte[] body,
            HttpServletRequest incoming
    ) {
        hostService.requirePublicOnline(slug);
        byte[] requestBody = body == null ? new byte[0] : body;
        if (requestBody.length > MAX_REQUEST_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE", "The request body exceeds 128 MiB.");
        }

        URI target = URI.create(properties.localGatewayBaseUrl() + path);
        HttpRequest.Builder request = HttpRequest.newBuilder(target)
                .header("User-Agent", "Coding-Agent-Gateway-Platform/3")
                .method(method, "GET".equals(method)
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofByteArray(requestBody));
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
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_GATEWAY_INTERRUPTED", "The local Gateway request was interrupted.");
        } catch (IOException | IllegalArgumentException error) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_GATEWAY_UNREACHABLE", "The local Coding Agent Gateway is not reachable.");
        }

        HttpHeaders responseHeaders = new HttpHeaders();
        FORWARDED_RESPONSE_HEADERS.forEach(name -> upstream.headers().allValues(name)
                .forEach(value -> responseHeaders.add(name, value)));
        StreamingResponseBody responseBody = output -> {
            try (InputStream input = upstream.body()) {
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, count);
                    output.flush();
                }
            }
        };
        return ResponseEntity.status(upstream.statusCode()).headers(responseHeaders).body(responseBody);
    }

    static String localGatewayHostHeader(URI target) {
        if (!"host.docker.internal".equalsIgnoreCase(target.getHost())) return null;
        int port = target.getPort() > 0 ? target.getPort() : 80;
        return "127.0.0.1:" + port;
    }
}

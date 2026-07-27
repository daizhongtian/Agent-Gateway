package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.host.HostService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class LocalRelayControllerTest {
    private HttpServer upstream;

    @AfterEach
    void stopServer() {
        if (upstream != null) upstream.stop(0);
    }

    @Test
    void forwardsAuthorizationBodySseAndRequestIdForAnOnlineHost() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/v1/chat/completions", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "data: {\"id\":\"chunk-1\"}\n\ndata: [DONE]\n\n".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.getResponseHeaders().set("X-Request-Id", "req_0123456789abcdef0123456789abcdef");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        upstream.start();

        HostService hosts = mock(HostService.class);
        PlatformProperties properties = new PlatformProperties(
                null, null, null, null, false, true,
                "http://127.0.0.1:" + upstream.getAddress().getPort(), false,
                null, null, null, 0, 0, 0);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/h/h-test/v1/chat/completions");
        request.addHeader("Authorization", "Bearer ccc_live_test-secret");
        request.addHeader("Content-Type", "application/json");
        byte[] body = "{\"model\":\"5.6 Sol\",\"stream\":true}".getBytes(StandardCharsets.UTF_8);

        ResponseEntity<StreamingResponseBody> response = controller.chatCompletions("h-test", body, request);
        ByteArrayOutputStream streamed = new ByteArrayOutputStream();
        response.getBody().writeTo(streamed);

        verify(hosts).requirePublicOnline("h-test");
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getFirst("content-type")).startsWith("text/event-stream");
        assertThat(response.getHeaders().getFirst("x-request-id")).isEqualTo("req_0123456789abcdef0123456789abcdef");
        assertThat(authorization.get()).isEqualTo("Bearer ccc_live_test-secret");
        assertThat(requestBody.get()).isEqualTo(new String(body, StandardCharsets.UTF_8));
        assertThat(streamed.toString(StandardCharsets.UTF_8)).contains("data: [DONE]");
    }

    @Test
    void rewritesDockerDesktopGatewayHostToTheLoopbackHostExpectedByTheDesktopApp() {
        assertThat(LocalRelayController.localGatewayHostHeader(
                URI.create("http://host.docker.internal:4310/v1/models")))
                .isEqualTo("127.0.0.1:4310");
        assertThat(LocalRelayController.localGatewayHostHeader(
                URI.create("http://127.0.0.1:4310/v1/models")))
                .isNull();
    }
}

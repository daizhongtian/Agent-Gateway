package com.codexcontrol.platform.relay;

import com.codexcontrol.platform.common.ApiException;
import com.codexcontrol.platform.config.PlatformProperties;
import com.codexcontrol.platform.host.HostService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
                null, null, null, 0, 0, 0, false);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/h/h-test/v1/chat/completions");
        request.addHeader("Authorization", "Bearer ccc_live_test-secret");
        request.addHeader("Content-Type", "application/json");
        byte[] body = "{\"model\":\"5.6 Sol\",\"stream\":true}".getBytes(StandardCharsets.UTF_8);

        request.setContent(body);
        ResponseEntity<StreamingResponseBody> response = controller.chatCompletions(
                "h-test", request, new MockHttpServletResponse());
        ByteArrayOutputStream streamed = new ByteArrayOutputStream();
        response.getBody().writeTo(streamed);

        verify(hosts).requirePublicOnline("h-test");
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getFirst("content-type")).startsWith("text/event-stream");
        assertThat(response.getHeaders().getFirst("x-accel-buffering")).isEqualTo("no");
        assertThat(response.getHeaders().getFirst("x-request-id")).isEqualTo("req_0123456789abcdef0123456789abcdef");
        assertThat(authorization.get()).isEqualTo("Bearer ccc_live_test-secret");
        assertThat(requestBody.get()).isEqualTo(new String(body, StandardCharsets.UTF_8));
        assertThat(streamed.toString(StandardCharsets.UTF_8)).contains("data: [DONE]");
    }

    @Test
    void flushesSseChunksAsTheyArriveInsteadOfBufferingUntilCompletion() throws Exception {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/v1/responses", exchange -> {
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write("data: {\"delta\":\"first\"}\n\n".getBytes(StandardCharsets.UTF_8));
            exchange.getResponseBody().flush();
            try {
                Thread.sleep(250);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
            exchange.getResponseBody().write("data: [DONE]\n\n".getBytes(StandardCharsets.UTF_8));
            exchange.close();
        });
        upstream.start();

        HostService hosts = mock(HostService.class);
        PlatformProperties properties = new PlatformProperties(
                null, null, null, null, false, true,
                "http://127.0.0.1:" + upstream.getAddress().getPort(), false,
                null, null, null, 0, 0, 0, false);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/h/h-test/v1/responses");
        request.setContent("{}".getBytes(StandardCharsets.UTF_8));

        jakarta.servlet.http.HttpServletResponse servletResponse = mock(jakarta.servlet.http.HttpServletResponse.class);
        ResponseEntity<StreamingResponseBody> response = controller.responses("h-test", request, servletResponse);
        FlushRecordingOutputStream output = new FlushRecordingOutputStream();
        response.getBody().writeTo(output);

        assertThat(output.toString(StandardCharsets.UTF_8)).contains("first").contains("[DONE]");
        assertThat(output.flushTimes).hasSizeGreaterThanOrEqualTo(2);
        assertThat(output.flushTimes.getLast() - output.flushTimes.getFirst()).isGreaterThanOrEqualTo(150L);
        verify(servletResponse, atLeast(2)).flushBuffer();
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

    @Test
    void boundedRelayInputStopsChunkedBodiesBeforeUnboundedConsumption() throws Exception {
        LocalRelayController.BoundedInputStream input = new LocalRelayController.BoundedInputStream(
                new ByteArrayInputStream(new byte[] { 1, 2, 3 }), 2);
        assertThat(input.read()).isEqualTo(1);
        assertThat(input.read()).isEqualTo(2);
        org.junit.jupiter.api.Assertions.assertThrows(IOException.class, input::read);
    }

    @Test
    void everySupportedRelayRouteRejectsAnUnavailableGatewayWithoutLeakingAnInternalFailure() {
        HostService hosts = mock(HostService.class);
        PlatformProperties properties = new PlatformProperties(
                null, null, null, null, false, true,
                "http://127.0.0.1:1", false,
                null, null, null, 0, 0, 0, false);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        MockHttpServletRequest get = new MockHttpServletRequest("GET", "/");

        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThatThrownBy(() -> controller.models("h-test", get, response))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("LOCAL_GATEWAY_UNREACHABLE");
        assertThatThrownBy(() -> controller.health("h-test", get, response))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("LOCAL_GATEWAY_UNREACHABLE");
    }

    @Test
    void supportedRelayRouteAdaptersCompleteAgainstAReachableGateway() throws Exception {
        upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        upstream.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] response = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        upstream.start();
        HostService hosts = mock(HostService.class);
        PlatformProperties properties = new PlatformProperties(
                null, null, null, null, false, true,
                "http://127.0.0.1:" + upstream.getAddress().getPort(), false,
                null, null, null, 0, 0, 0, false);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        MockHttpServletRequest get = new MockHttpServletRequest("GET", "/");
        MockHttpServletRequest post = new MockHttpServletRequest("POST", "/");
        post.setContent("{}".getBytes(StandardCharsets.UTF_8));

        for (ResponseEntity<StreamingResponseBody> response : new ResponseEntity[] {
                controller.models("h-test", get, new MockHttpServletResponse()),
                controller.health("h-test", get, new MockHttpServletResponse()),
                controller.responses("h-test", post, new MockHttpServletResponse())
        }) {
            assertThat(response.getStatusCode().value()).isEqualTo(200);
            response.getBody().writeTo(new ByteArrayOutputStream());
        }
    }

    @Test
    void unreadableAndPredeclaredOversizedRequestBodiesAreRejectedBeforeProxying() throws Exception {
        HostService hosts = mock(HostService.class);
        PlatformProperties properties = new PlatformProperties(
                null, null, null, null, false, true,
                "http://127.0.0.1:1", false,
                null, null, null, 0, 0, 0, false);
        LocalRelayController controller = new LocalRelayController(hosts, properties);
        jakarta.servlet.http.HttpServletRequest unreadable = mock(jakarta.servlet.http.HttpServletRequest.class);
        when(unreadable.getInputStream()).thenThrow(new IOException("synthetic unreadable body"));
        assertThatThrownBy(() -> controller.responses("h-test", unreadable, new MockHttpServletResponse()))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("REQUEST_BODY_UNREADABLE");

        jakarta.servlet.http.HttpServletRequest oversized = mock(jakarta.servlet.http.HttpServletRequest.class);
        when(oversized.getContentLengthLong()).thenReturn(36L * 1024 * 1024 + 1);
        assertThatThrownBy(() -> controller.chatCompletions("h-test", oversized, new MockHttpServletResponse()))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("REQUEST_TOO_LARGE");
    }

    @Test
    void boundedRelayInputEnforcesTheLimitForBulkReadsAndPreservesEndOfStream() throws Exception {
        LocalRelayController.BoundedInputStream exact = new LocalRelayController.BoundedInputStream(
                new ByteArrayInputStream(new byte[] { 1, 2 }), 2);
        byte[] buffer = new byte[4];
        assertThat(exact.read(buffer, 0, buffer.length)).isEqualTo(2);
        assertThat(exact.read(buffer, 0, buffer.length)).isEqualTo(-1);

        LocalRelayController.BoundedInputStream overflowing = new LocalRelayController.BoundedInputStream(
                new ByteArrayInputStream(new byte[] { 1, 2, 3 }), 2);
        assertThat(overflowing.read(buffer, 0, buffer.length)).isEqualTo(2);
        org.junit.jupiter.api.Assertions.assertThrows(IOException.class,
                () -> overflowing.read(buffer, 0, buffer.length));
    }

    private static final class FlushRecordingOutputStream extends OutputStream {
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final List<Long> flushTimes = new ArrayList<>();

        @Override
        public void write(int value) {
            bytes.write(value);
        }

        @Override
        public void write(byte[] buffer, int offset, int length) {
            bytes.write(buffer, offset, length);
        }

        @Override
        public void flush() {
            flushTimes.add(System.nanoTime() / 1_000_000);
        }

        String toString(java.nio.charset.Charset charset) {
            return bytes.toString(charset);
        }
    }
}

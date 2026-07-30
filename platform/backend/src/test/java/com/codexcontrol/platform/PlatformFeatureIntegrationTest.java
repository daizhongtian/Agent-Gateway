package com.codexcontrol.platform;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformFeatureIntegrationTest {
    private static final AtomicInteger IP_SEQUENCE = new AtomicInteger(10);

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void publicStatusConfigurationRequestIdsAndAuthenticationBoundaryWork() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Request-Id", org.hamcrest.Matchers.matchesPattern("req_[0-9a-f]{32}")))
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.status").value("ok"));

        mvc.perform(get("/api/v1/readiness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.database").value("ready"));

        mvc.perform(get("/api/v1/platform/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.platformVersion").value("0.1.0"))
                .andExpect(jsonPath("$.publicHostDomain").value("api.test.local"))
                .andExpect(jsonPath("$.relayEnabled").value(false))
                .andExpect(jsonPath("$.allowedPublicRoutes.length()").value(3));

        MvcResult unauthorized = mvc.perform(get("/api/v1/devices"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTHENTICATION_REQUIRED"))
                .andReturn();
        assertThat(objectMapper.readTree(unauthorized.getResponse().getContentAsString())
                .path("error").path("requestId").asText())
                .isEqualTo(unauthorized.getResponse().getHeader("X-Request-Id"));

        mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{not-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_JSON"));
    }

    @Test
    void browserAuthenticationRefreshAccountUpdateAndLogoutWork() throws Exception {
        String email = uniqueEmail("browser");
        BrowserSession session = registerBrowser(email, "Initial Owner");

        mvc.perform(get("/api/v1/auth/session").cookie(session.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(email))
                .andExpect(jsonPath("$.accessExpiresAt").isString());

        mvc.perform(patch("/api/v1/account")
                        .cookie(session.access(), session.csrfCookie())
                        .header("X-CSRF-Token", session.csrfToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"Renamed Owner\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Renamed Owner"));

        mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email.toUpperCase(), "a-secure-test-password", "Duplicate", "browser")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("USERNAME_ALREADY_REGISTERED"));

        MvcResult refreshed = mvc.perform(postFrom("/api/v1/auth/refresh", nextIp())
                        .cookie(session.access(), session.refresh(), session.csrfCookie())
                        .header("X-CSRF-Token", session.csrfToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientType\":\"desktop\"}"))
                .andExpect(status().isOk())
                .andExpect(cookie().exists("ccc_platform_access"))
                .andExpect(cookie().exists("ccc_platform_refresh"))
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();
        BrowserSession rotated = browserSession(refreshed);

        mvc.perform(get("/api/v1/auth/session").cookie(session.access()))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/session").cookie(rotated.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.displayName").value("Renamed Owner"));

        mvc.perform(post("/api/v1/auth/logout")
                        .cookie(rotated.access(), rotated.csrfCookie())
                        .header("X-CSRF-Token", rotated.csrfToken()))
                .andExpect(status().isNoContent())
                .andExpect(header().stringValues("Set-Cookie", org.hamcrest.Matchers.hasItems(
                        org.hamcrest.Matchers.containsString("ccc_platform_access=;"),
                        org.hamcrest.Matchers.containsString("ccc_platform_refresh=;"))));

        mvc.perform(get("/api/v1/auth/session").cookie(rotated.access()))
                .andExpect(status().isUnauthorized());

        mvc.perform(postFrom("/api/v1/auth/login", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email, "wrong-password", null, "browser")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));
        mvc.perform(postFrom("/api/v1/auth/login", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(uniqueEmail("missing"), "wrong-password", null, "browser")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));
        mvc.perform(postFrom("/api/v1/auth/login", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email, "a-secure-test-password", null, "browser")))
                .andExpect(status().isOk())
                .andExpect(cookie().httpOnly("ccc_platform_access", true));
    }

    @Test
    void desktopBearerAuthenticationRotatesTokensAndDoesNotNeedCsrf() throws Exception {
        String email = uniqueEmail("desktop");
        MvcResult registration = mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email, "a-secure-test-password", "Desktop Owner", "desktop")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").isString())
                .andExpect(jsonPath("$.refreshToken").isString())
                .andExpect(cookie().doesNotExist("ccc_platform_access"))
                .andReturn();
        JsonNode tokens = json(registration);
        String oldAccess = tokens.path("accessToken").asText();
        String oldRefresh = tokens.path("refreshToken").asText();

        mvc.perform(post("/api/v1/devices")
                        .header("Authorization", "Bearer " + oldAccess)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Desktop bearer device\",\"platform\":\"linux\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.platform").value("linux"));

        MvcResult refresh = mvc.perform(postFrom("/api/v1/auth/refresh", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"" + oldRefresh + "\",\"clientType\":\"desktop\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isString())
                .andExpect(jsonPath("$.refreshToken").isString())
                .andReturn();
        String newAccess = json(refresh).path("accessToken").asText();
        String newRefresh = json(refresh).path("refreshToken").asText();
        assertThat(newAccess).isNotEqualTo(oldAccess);
        assertThat(newRefresh).isNotEqualTo(oldRefresh);

        mvc.perform(get("/api/v1/devices").header("Authorization", "Bearer " + oldAccess))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/devices").header("Authorization", "Bearer " + newAccess))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Desktop bearer device"));

        mvc.perform(post("/api/v1/auth/logout").header("Authorization", "Bearer " + newAccess))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/devices").header("Authorization", "Bearer " + newAccess))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void devicePairingHostLifecycleOwnershipAndRevocationWork() throws Exception {
        BrowserSession owner = registerBrowser(uniqueEmail("owner"), "Host Owner");
        BrowserSession stranger = registerBrowser(uniqueEmail("stranger"), "Other Owner");

        MvcResult createdDevice = mvc.perform(authenticatedJson(post("/api/v1/devices"), owner)
                        .content("{\"name\":\"Primary Windows PC\",\"platform\":\"windows\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending"))
                .andReturn();
        String deviceId = json(createdDevice).path("id").asText();

        mvc.perform(authenticatedJson(patch("/api/v1/devices/{id}", deviceId), owner)
                        .content("{\"name\":\"Renamed Windows PC\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Renamed Windows PC"));

        MvcResult hostResult = mvc.perform(authenticatedJson(post("/api/v1/hosts"), owner)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Primary Host\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("offline"))
                .andExpect(jsonPath("$.desiredOnline").value(false))
                .andExpect(jsonPath("$.relayReady").value(false))
                .andReturn();
        JsonNode host = json(hostResult);
        String hostId = host.path("id").asText();
        assertThat(host.path("openAiBaseUrl").asText())
                .matches("https://h-[a-z0-9-]+\\.api\\.test\\.local/v1");

        String firstCode = pairingCode(owner, deviceId);
        String secondCode = pairingCode(owner, deviceId);
        assertThat(secondCode).isNotEqualTo(firstCode);

        mvc.perform(postFrom("/api/v1/desktop/pair", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pairJson(firstCode)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_PAIRING_CODE"));

        MvcResult pairing = mvc.perform(postFrom("/api/v1/desktop/pair", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pairJson(secondCode)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deviceSecret", org.hamcrest.Matchers.startsWith("ccc_dev_")))
                .andExpect(jsonPath("$.relayEnabled").value(false))
                .andExpect(jsonPath("$.hosts[0].id").value(hostId))
                .andReturn();
        assertThat(json(pairing).path("deviceSecret").asText()).hasSizeGreaterThan(50);

        mvc.perform(postFrom("/api/v1/desktop/pair", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pairJson(secondCode)))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/devices").cookie(owner.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("active"))
                .andExpect(jsonPath("$[0].appVersion").value("1.2.3-test"));

        mvc.perform(authenticatedJson(patch("/api/v1/hosts/{id}", hostId), owner)
                        .content("{\"displayName\":\"Updated Host\",\"desiredOnline\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Updated Host"))
                .andExpect(jsonPath("$.desiredOnline").value(true))
                .andExpect(jsonPath("$.status").value("offline"));

        mvc.perform(authenticated(post("/api/v1/hosts/{id}/disable", hostId), owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("disabled"));
        mvc.perform(authenticatedJson(patch("/api/v1/hosts/{id}", hostId), owner)
                        .content("{\"displayName\":\"Blocked update\",\"desiredOnline\":true}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("HOST_DISABLED"));
        mvc.perform(authenticated(post("/api/v1/hosts/{id}/enable", hostId), owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("offline"));

        mvc.perform(authenticatedJson(patch("/api/v1/devices/{id}", deviceId), stranger)
                        .content("{\"name\":\"Cannot rename\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("DEVICE_NOT_FOUND"));
        mvc.perform(authenticatedJson(post("/api/v1/hosts"), stranger)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Stolen Host\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(authenticated(post("/api/v1/hosts/{id}/disable", hostId), stranger))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("HOST_NOT_FOUND"));

        mvc.perform(authenticated(delete("/api/v1/devices/{id}", deviceId), owner))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/hosts").cookie(owner.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("disabled"))
                .andExpect(jsonPath("$[0].desiredOnline").value(false));
        mvc.perform(authenticated(post("/api/v1/hosts/{id}/enable", hostId), owner))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("DEVICE_REVOKED"));
        mvc.perform(authenticated(post("/api/v1/devices/{id}/pairing-code", deviceId), owner))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("DEVICE_REVOKED"));
    }

    @Test
    void validationCsrfInvalidIdentifiersAndRateLimitsReturnSafeErrors() throws Exception {
        mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson("not-an-email", "short", "X", "browser")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.details.email").exists())
                .andExpect(jsonPath("$.error.details.password").exists());

        String unicodePassword = "密".repeat(30);
        mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(uniqueEmail("unicode"), unicodePassword, "Unicode Password", "browser")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("PASSWORD_TOO_LONG"));

        BrowserSession session = registerBrowser(uniqueEmail("security"), "Security Owner");
        mvc.perform(post("/api/v1/devices")
                        .cookie(session.access(), session.csrfCookie())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Blocked\",\"platform\":\"windows\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_REJECTED"));
        mvc.perform(authenticatedJson(post("/api/v1/devices"), session)
                        .content("{\"name\":\"Bad platform\",\"platform\":\"android\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));

        mvc.perform(authenticated(patch("/api/v1/devices/not-a-uuid"), session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Valid Name\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_PARAMETER"));

        String rateIp = "192.0.2.200";
        for (int attempt = 0; attempt < 20; attempt++) {
            mvc.perform(postFrom("/api/v1/auth/login", rateIp)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(authJson(uniqueEmail("rate"), "wrong-password", null, "browser")))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(postFrom("/api/v1/auth/login", rateIp)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(uniqueEmail("rate"), "wrong-password", null, "browser")))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    private BrowserSession registerBrowser(String email, String displayName) throws Exception {
        MvcResult result = mvc.perform(postFrom("/api/v1/auth/register", nextIp())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email, "a-secure-test-password", displayName, "browser")))
                .andExpect(status().isCreated())
                .andExpect(cookie().httpOnly("ccc_platform_access", true))
                .andExpect(cookie().httpOnly("ccc_platform_refresh", true))
                .andExpect(cookie().httpOnly("ccc_platform_csrf", false))
                .andReturn();
        return browserSession(result);
    }

    private BrowserSession browserSession(MvcResult result) throws Exception {
        String csrf = json(result).path("csrfToken").asText();
        Cookie csrfCookie = result.getResponse().getCookie("ccc_platform_csrf");
        assertThat(csrfCookie).isNotNull();
        assertThat(csrfCookie.getValue()).isEqualTo(csrf);
        return new BrowserSession(
                result.getResponse().getCookie("ccc_platform_access"),
                result.getResponse().getCookie("ccc_platform_refresh"),
                csrfCookie,
                csrf);
    }

    private String pairingCode(BrowserSession session, String deviceId) throws Exception {
        MvcResult result = mvc.perform(authenticated(post("/api/v1/devices/{id}/pairing-code", deviceId), session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code", org.hamcrest.Matchers.matchesPattern("[A-Z0-9]{4}-[A-Z0-9]{4}")))
                .andReturn();
        return json(result).path("code").asText();
    }

    private MockHttpServletRequestBuilder authenticated(MockHttpServletRequestBuilder builder, BrowserSession session) {
        return builder.cookie(session.access(), session.csrfCookie())
                .header("X-CSRF-Token", session.csrfToken());
    }

    private MockHttpServletRequestBuilder authenticatedJson(MockHttpServletRequestBuilder builder, BrowserSession session) {
        return authenticated(builder, session).contentType(MediaType.APPLICATION_JSON);
    }

    private MockHttpServletRequestBuilder postFrom(String path, String remoteAddress) {
        return post(path).header("User-Agent", "Platform-Test-Agent/1.0").with(request -> {
            request.setRemoteAddr(remoteAddress);
            return request;
        });
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private static String nextIp() {
        int value = IP_SEQUENCE.getAndIncrement();
        return "198.51." + ((value / 250) % 250) + "." + ((value % 250) + 1);
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "." + UUID.randomUUID().toString().replace("-", "") + "@example.com";
    }

    private static String authJson(String email, String password, String displayName, String clientType) {
        int at = email.indexOf('@');
        String localPart = at > 0 ? email.substring(0, at) : email;
        String username = localPart.substring(0, Math.min(localPart.length(), 32)).toLowerCase(java.util.Locale.ROOT);
        String name = displayName == null ? "" : ",\"displayName\":\"" + displayName + "\"";
        return "{\"username\":\"" + username + "\",\"email\":\"" + email + "\",\"password\":\"" + password + "\"" + name
                + ",\"clientType\":\"" + clientType + "\"}";
    }

    private static String pairJson(String code) {
        return "{\"code\":\"" + code + "\",\"publicKey\":\""
                + "-----BEGIN PUBLIC KEY-----test-key-material-----END PUBLIC KEY-----"
                + "\",\"appVersion\":\"1.2.3-test\",\"platform\":\"windows\"}";
    }

    private record BrowserSession(Cookie access, Cookie refresh, Cookie csrfCookie, String csrfToken) {
    }
}

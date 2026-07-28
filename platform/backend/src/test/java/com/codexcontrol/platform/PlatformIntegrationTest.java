package com.codexcontrol.platform;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PlatformIntegrationTest {
    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void accountDevicePairingAndHostAllocationFlow() throws Exception {
        MvcResult registration = mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "owner@example.com",
                                  "password": "a-secure-test-password",
                                  "displayName": "Owner",
                                  "clientType": "browser"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.email").value("owner@example.com"))
                .andReturn();

        Cookie access = registration.getResponse().getCookie("ccc_platform_access");
        Cookie csrfCookie = registration.getResponse().getCookie("ccc_platform_csrf");
        JsonNode registrationBody = objectMapper.readTree(registration.getResponse().getContentAsString());
        String csrf = registrationBody.path("csrfToken").asText();
        assertThat(access).isNotNull();
        assertThat(csrfCookie).isNotNull();
        assertThat(csrfCookie.getValue()).isEqualTo(csrf);

        MvcResult deviceResult = mvc.perform(MockMvcRequestBuilders.post("/api/v1/devices")
                        .cookie(access, csrfCookie)
                        .header("X-CSRF-Token", csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Primary Windows PC","platform":"windows"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending"))
                .andReturn();
        String deviceId = objectMapper.readTree(deviceResult.getResponse().getContentAsString()).path("id").asText();

        mvc.perform(MockMvcRequestBuilders.post("/api/v1/devices/{id}/pairing-code", deviceId)
                        .cookie(access, csrfCookie)
                        .header("X-CSRF-Token", csrf))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").isString());

        MvcResult hostResult = mvc.perform(MockMvcRequestBuilders.post("/api/v1/hosts")
                        .cookie(access, csrfCookie)
                        .header("X-CSRF-Token", csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"deviceId":"%s","displayName":"Primary Host"}
                                """.formatted(deviceId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("offline"))
                .andExpect(jsonPath("$.relayReady").value(false))
                .andReturn();

        JsonNode host = objectMapper.readTree(hostResult.getResponse().getContentAsString());
        assertThat(host.path("openAiBaseUrl").asText())
                .startsWith("https://h-")
                .endsWith(".api.test.local/v1");
    }

    @Test
    void rejectsCookieMutationWithoutCsrfHeader() throws Exception {
        MvcResult registration = mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "csrf@example.com",
                                  "password": "a-secure-test-password",
                                  "displayName": "CSRF Test",
                                  "clientType": "browser"
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();

        mvc.perform(MockMvcRequestBuilders.post("/api/v1/devices")
                        .cookie(
                                registration.getResponse().getCookie("ccc_platform_access"),
                                registration.getResponse().getCookie("ccc_platform_csrf"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Blocked Device\",\"platform\":\"windows\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_REJECTED"));
    }

    @Test
    void browserCanIssueAndExchangeOneTimeDesktopAuthorizationWithPkce() throws Exception {
        MvcResult registration = mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "email": "desktop-browser-auth@example.com",
                                  "password": "a-secure-test-password",
                                  "displayName": "Desktop Browser Auth",
                                  "clientType": "browser"
                                }
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        Cookie access = registration.getResponse().getCookie("ccc_platform_access");
        Cookie csrfCookie = registration.getResponse().getCookie("ccc_platform_csrf");
        String csrf = objectMapper.readTree(registration.getResponse().getContentAsString()).path("csrfToken").asText();
        String verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));

        MvcResult authorization = mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/desktop/authorize")
                        .cookie(access, csrfCookie)
                        .header("X-CSRF-Token", csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"codeChallenge\":\"%s\"}".formatted(challenge)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").isString())
                .andExpect(jsonPath("$.expiresAt").isString())
                .andReturn();
        String code = objectMapper.readTree(authorization.getResponse().getContentAsString()).path("code").asText();

        mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/desktop/exchange")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"%s\",\"codeVerifier\":\"%s\"}".formatted(code, verifier)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value("desktop-browser-auth@example.com"))
                .andExpect(jsonPath("$.accessToken").value(org.hamcrest.Matchers.startsWith("ccc_at_")))
                .andExpect(jsonPath("$.refreshToken").value(org.hamcrest.Matchers.startsWith("ccc_rt_")));

        mvc.perform(MockMvcRequestBuilders.post("/api/v1/auth/desktop/exchange")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"%s\",\"codeVerifier\":\"%s\"}".formatted(code, verifier)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_DESKTOP_AUTHORIZATION"));
    }
}

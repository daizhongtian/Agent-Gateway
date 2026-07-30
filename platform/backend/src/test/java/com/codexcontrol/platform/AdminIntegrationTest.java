package com.codexcontrol.platform;

import com.codexcontrol.platform.account.AccountRole;
import com.codexcontrol.platform.account.UserAccount;
import com.codexcontrol.platform.account.UserAccountRepository;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AdminIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserAccountRepository users;

    @Test
    void administratorBoundaryOverviewAndSelfProtectionAreEnforced() throws Exception {
        BrowserSession ordinary = register("ordinary");
        mvc.perform(get("/api/v1/admin/overview").cookie(ordinary.access()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ACCESS_DENIED"));
        mvc.perform(get("/api/v1/admin/overview"))
                .andExpect(status().isUnauthorized());

        BrowserSession admin = register("admin");
        promote(admin.userId());
        mvc.perform(get("/api/v1/auth/session").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.role").value("admin"));
        mvc.perform(get("/api/v1/admin/overview").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalUsers").isNumber())
                .andExpect(jsonPath("$.activeUsers").isNumber())
                .andExpect(jsonPath("$.auditEvents").isNumber());

        MvcResult listed = mvc.perform(get("/api/v1/admin/users?size=500").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.items[0].email").isString())
                .andReturn();
        assertThat(listed.getResponse().getContentAsString())
                .doesNotContain("passwordHash", "accessToken", "refreshToken");

        mvc.perform(action(post("/api/v1/admin/users/{id}/disable", admin.userId()), admin, "self test"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("ADMIN_SELF_DISABLE_FORBIDDEN"));
    }

    @Test
    void administratorActionsCascadeRevokeSessionsAndCreateAuditEvents() throws Exception {
        BrowserSession admin = register("operator");
        promote(admin.userId());
        BrowserSession target = register("target");

        MvcResult deviceResult = mvc.perform(json(post("/api/v1/devices"), target)
                        .content("{\"name\":\"Managed PC\",\"platform\":\"windows\"}"))
                .andExpect(status().isCreated()).andReturn();
        String deviceId = body(deviceResult).path("id").asText();
        MvcResult hostResult = mvc.perform(json(post("/api/v1/hosts"), target)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Managed Host\"}"))
                .andExpect(status().isCreated()).andReturn();
        String hostId = body(hostResult).path("id").asText();

        mvc.perform(action(post("/api/v1/admin/hosts/{id}/disable", hostId), admin, "unexpected traffic"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("disabled"));
        mvc.perform(action(post("/api/v1/admin/devices/{id}/revoke", deviceId), admin, "device retired"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("revoked"));

        mvc.perform(action(post("/api/v1/admin/users/{id}/disable", target.userId()), admin, "account review"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("disabled"));
        mvc.perform(get("/api/v1/auth/session").cookie(target.access()))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/admin/devices?size=100").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == '" + deviceId + "')].status").value("revoked"));
        mvc.perform(get("/api/v1/admin/hosts?size=100").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == '" + hostId + "')].status").value("disabled"));

        mvc.perform(action(post("/api/v1/admin/users/{id}/enable", target.userId()), admin, "review complete"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"));
        mvc.perform(get("/api/v1/auth/session").cookie(target.access()))
                .andExpect(status().isUnauthorized());

        MvcResult audit = mvc.perform(get("/api/v1/admin/audit-events?size=100").cookie(admin.access()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalItems").value(org.hamcrest.Matchers.greaterThanOrEqualTo(4)))
                .andExpect(jsonPath("$.items[0].actorEmail").value(admin.email()))
                .andExpect(jsonPath("$.items[0].requestId", org.hamcrest.Matchers.matchesPattern("req_[0-9a-f]{32}")))
                .andReturn();
        assertThat(audit.getResponse().getContentAsString()).doesNotContain("Gateway", "passwordHash");
    }

    @Test
    void administratorMutationsRequireCsrfAndValidateReasons() throws Exception {
        BrowserSession admin = register("csrf-admin");
        promote(admin.userId());
        BrowserSession target = register("csrf-target");

        mvc.perform(post("/api/v1/admin/users/{id}/disable", target.userId())
                        .cookie(admin.access(), admin.csrfCookie())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_REJECTED"));
        mvc.perform(action(post("/api/v1/admin/users/{id}/disable", target.userId()), admin, "x".repeat(501)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    private BrowserSession register(String prefix) throws Exception {
        String email = prefix + "." + UUID.randomUUID().toString().replace("-", "") + "@example.com";
        String username = email.substring(0, Math.min(email.indexOf('@'), 32));
        MvcResult result = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"email\":\"" + email + "\",\"password\":\"a-secure-test-password\",\"displayName\":\"Test User\",\"clientType\":\"browser\"}"))
                .andExpect(status().isCreated()).andReturn();
        JsonNode body = body(result);
        return new BrowserSession(
                UUID.fromString(body.path("user").path("id").asText()), email,
                result.getResponse().getCookie("ccc_platform_access"),
                result.getResponse().getCookie("ccc_platform_csrf"), body.path("csrfToken").asText());
    }

    private void promote(UUID userId) {
        UserAccount user = users.findById(userId).orElseThrow();
        user.promoteToAdmin();
        users.saveAndFlush(user);
        assertThat(user.getRole()).isEqualTo(AccountRole.ADMIN);
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, BrowserSession session) {
        return request.cookie(session.access(), session.csrfCookie())
                .header("X-CSRF-Token", session.csrfToken()).contentType(MediaType.APPLICATION_JSON);
    }

    private MockHttpServletRequestBuilder action(MockHttpServletRequestBuilder request, BrowserSession session, String reason) {
        return json(request, session).content("{\"reason\":\"" + reason + "\"}");
    }

    private JsonNode body(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private record BrowserSession(UUID userId, String email, Cookie access, Cookie csrfCookie, String csrfToken) {
    }
}

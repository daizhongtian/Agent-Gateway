package com.codexcontrol.platform;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "platform.secure-cookies=true",
        "platform.relay-enabled=true",
        "platform.public-host-domain=hosts.example.test",
        "spring.datasource.url=jdbc:h2:mem:platform-configuration;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PlatformConfigurationIntegrationTest {
    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void secureCookieRelayAndPublicDomainConfigurationAreApplied() throws Exception {
        String email = "config." + UUID.randomUUID().toString().replace("-", "") + "@example.com";
        String username = email.substring(0, Math.min(email.indexOf('@'), 32));
        MvcResult registration = mvc.perform(post("/api/v1/auth/register")
                        .with(request -> { request.setRemoteAddr("203.0.113.70"); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"email\":\"" + email + "\",\"password\":\"a-secure-test-password\","
                                + "\"displayName\":\"Config Owner\",\"clientType\":\"browser\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        assertThat(registration.getResponse().getHeaders("Set-Cookie"))
                .allMatch(value -> value.contains("Secure"))
                .allMatch(value -> value.contains("SameSite=Strict"));

        String csrf = objectMapper.readTree(registration.getResponse().getContentAsString()).path("csrfToken").asText();
        MvcResult device = mvc.perform(post("/api/v1/devices")
                        .cookie(registration.getResponse().getCookie("ccc_platform_access"),
                                registration.getResponse().getCookie("ccc_platform_csrf"))
                        .header("X-CSRF-Token", csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Relay Device\",\"platform\":\"macos\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String deviceId = objectMapper.readTree(device.getResponse().getContentAsString()).path("id").asText();

        mvc.perform(post("/api/v1/hosts")
                        .cookie(registration.getResponse().getCookie("ccc_platform_access"),
                                registration.getResponse().getCookie("ccc_platform_csrf"))
                        .header("X-CSRF-Token", csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Relay Host\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.relayReady").value(true))
                .andExpect(jsonPath("$.openAiBaseUrl", org.hamcrest.Matchers.endsWith(".hosts.example.test/v1")));
    }
}

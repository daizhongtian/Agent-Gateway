package com.codexcontrol.platform;

import jakarta.servlet.http.Cookie;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "platform.max-sessions-per-user=1",
        "platform.max-devices-per-user=1",
        "platform.max-hosts-per-user=1",
        "spring.datasource.url=jdbc:h2:mem:platform-limits;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PlatformLimitsIntegrationTest {
    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void configuredSessionDeviceAndHostLimitsAreEnforced() throws Exception {
        String email = "limits." + UUID.randomUUID().toString().replace("-", "") + "@example.com";
        String username = email.substring(0, Math.min(email.indexOf('@'), 32));
        MvcResult registration = mvc.perform(post("/api/v1/auth/register")
                        .with(request -> { request.setRemoteAddr("203.0.113.10"); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(authJson(email)))
                .andExpect(status().isCreated())
                .andReturn();
        Session first = session(registration);

        MvcResult login = mvc.perform(post("/api/v1/auth/login")
                        .with(request -> { request.setRemoteAddr("203.0.113.11"); return request; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"a-secure-test-password\",\"clientType\":\"browser\"}"))
                .andExpect(status().isOk())
                .andReturn();
        Session current = session(login);
        mvc.perform(get("/api/v1/auth/session").cookie(first.access()))
                .andExpect(status().isUnauthorized());

        MvcResult device = mvc.perform(post("/api/v1/devices")
                        .cookie(current.access(), current.csrfCookie())
                        .header("X-CSRF-Token", current.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Only Device\",\"platform\":\"windows\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String deviceId = objectMapper.readTree(device.getResponse().getContentAsString()).path("id").asText();

        mvc.perform(post("/api/v1/devices")
                        .cookie(current.access(), current.csrfCookie())
                        .header("X-CSRF-Token", current.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Second Device\",\"platform\":\"linux\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("DEVICE_LIMIT_REACHED"));

        mvc.perform(post("/api/v1/hosts")
                        .cookie(current.access(), current.csrfCookie())
                        .header("X-CSRF-Token", current.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Only Host\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/hosts")
                        .cookie(current.access(), current.csrfCookie())
                        .header("X-CSRF-Token", current.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceId\":\"" + deviceId + "\",\"displayName\":\"Second Host\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("HOST_LIMIT_REACHED"));
    }

    private Session session(MvcResult result) throws Exception {
        return new Session(
                result.getResponse().getCookie("ccc_platform_access"),
                result.getResponse().getCookie("ccc_platform_csrf"),
                objectMapper.readTree(result.getResponse().getContentAsString()).path("csrfToken").asText());
    }

    private static String authJson(String email) {
        String username = email.substring(0, Math.min(email.indexOf('@'), 32));
        return "{\"username\":\"" + username + "\",\"email\":\"" + email + "\",\"password\":\"a-secure-test-password\","
                + "\"displayName\":\"Limits Owner\",\"clientType\":\"browser\"}";
    }

    private record Session(Cookie access, Cookie csrfCookie, String csrf) {
    }
}

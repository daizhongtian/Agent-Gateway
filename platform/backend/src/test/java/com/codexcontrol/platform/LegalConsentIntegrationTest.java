package com.codexcontrol.platform;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "platform.legal-consent-required=true",
        "spring.datasource.url=jdbc:h2:mem:legal-consent;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LegalConsentIntegrationTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void registrationAndLoginRequireTheCurrentTermsVersion() throws Exception {
        String email = "legal." + UUID.randomUUID().toString().replace("-", "") + "@example.com";
        String password = "a-secure-test-password";

        mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\","
                                + "\"clientType\":\"browser\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("LEGAL_CONSENT_REQUIRED"));

        mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\","
                                + "\"clientType\":\"browser\",\"termsAccepted\":true,"
                                + "\"termsVersion\":\"2026-07-29\"}"))
                .andExpect(status().isCreated());

        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\","
                                + "\"clientType\":\"browser\",\"termsAccepted\":false,"
                                + "\"termsVersion\":\"2026-07-29\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("LEGAL_CONSENT_REQUIRED"));

        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\","
                                + "\"clientType\":\"browser\",\"termsAccepted\":true,"
                                + "\"termsVersion\":\"2026-07-29\"}"))
                .andExpect(status().isOk());
    }
}

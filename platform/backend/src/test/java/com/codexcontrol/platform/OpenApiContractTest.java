package com.codexcontrol.platform;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiContractTest {
    private static final Set<String> HTTP_METHODS = Set.of("get", "post", "put", "patch", "delete");

    @Test
    void contractIsValidYamlAndDocumentsEveryControllerOperation() throws IOException {
        Path contract = Path.of("..", "docs", "openapi.yaml");
        Map<String, Object> document;
        try (Reader reader = Files.newBufferedReader(contract)) {
            document = new Yaml().load(reader);
        }

        assertThat(document.get("openapi")).isEqualTo("3.1.0");
        Map<String, Map<String, Map<String, Object>>> paths = cast(document.get("paths"));
        assertThat(paths).hasSize(29);

        Set<String> operationIds = new HashSet<>();
        int operationCount = 0;
        for (Map<String, Map<String, Object>> pathItem : paths.values()) {
            for (Map.Entry<String, Map<String, Object>> entry : pathItem.entrySet()) {
                if (!HTTP_METHODS.contains(entry.getKey())) {
                    continue;
                }
                operationCount++;
                Object operationId = entry.getValue().get("operationId");
                assertThat(operationId).as("Every API operation has an operationId").isInstanceOf(String.class);
                assertThat(operationIds.add((String) operationId)).as("operationId is unique: %s", operationId).isTrue();
            }
        }

        assertThat(operationCount).isEqualTo(32);
    }

    @SuppressWarnings("unchecked")
    private static <T> T cast(Object value) {
        return (T) value;
    }
}

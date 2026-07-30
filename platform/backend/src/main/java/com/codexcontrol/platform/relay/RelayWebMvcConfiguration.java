package com.codexcontrol.platform.relay;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.VirtualThreadTaskExecutor;
import org.springframework.web.servlet.config.annotation.AsyncSupportConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Runs MVC streaming callbacks on virtual threads.
 *
 * <p>A StreamingResponseBody occupies its executor thread for the lifetime of
 * the response. Spring's small default platform-thread pool therefore queues
 * otherwise healthy SSE requests once concurrent streams exceed the core pool
 * size. The Relay controller has its own bounded admission semaphore, so
 * virtual threads remove that artificial queue without removing the resource
 * limit.</p>
 */
@Configuration(proxyBeanMethods = false)
public class RelayWebMvcConfiguration implements WebMvcConfigurer {
    private final VirtualThreadTaskExecutor streamingExecutor =
            new VirtualThreadTaskExecutor("relay-stream-");

    @Override
    public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        configurer.setTaskExecutor(streamingExecutor);
    }
}

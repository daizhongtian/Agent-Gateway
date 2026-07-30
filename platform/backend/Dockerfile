# syntax=docker/dockerfile:1.7

FROM maven:3.9.11-eclipse-temurin-21-alpine@sha256:922927df2c662cdd47ddb116443d6bec4696cfae3de1a0ddac8fcc7b87ce61ae AS build
WORKDIR /workspace
COPY backend/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests dependency:go-offline
COPY backend/src ./src
COPY docs /docs
RUN --mount=type=cache,target=/root/.m2 mvn -B package

FROM eclipse-temurin:21-jre-alpine@sha256:3f08b13888f595cc49edabea7250ba69499ba25602b267da591720769400e08c
RUN addgroup -S platform && adduser -S platform -G platform
WORKDIR /app
COPY --from=build /workspace/target/platform-backend-*.jar /app/platform.jar
USER platform
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/platform.jar"]

# syntax=docker/dockerfile:1.7

FROM maven:3.9.11-eclipse-temurin-21-alpine AS build
WORKDIR /workspace
COPY backend/pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests dependency:go-offline
COPY backend/src ./src
COPY docs /docs
RUN --mount=type=cache,target=/root/.m2 mvn -B package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S platform && adduser -S platform -G platform
WORKDIR /app
COPY --from=build /workspace/target/platform-backend-*.jar /app/platform.jar
USER platform
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/platform.jar"]

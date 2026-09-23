FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY backend/pom.xml ./pom.xml
RUN mvn -B dependency:go-offline
COPY backend/src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN groupadd --gid 10001 hr && useradd --uid 10001 --gid hr --no-create-home hr \
    && mkdir -p /app/uploads && chown hr:hr /app/uploads
COPY --from=build /build/target/hr-backend-1.0.0.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENV SERVER_ADDRESS=0.0.0.0 HR_UPLOAD_DIRECTORY=/app/uploads
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]

FROM oven/bun:latest

# Install git (for check-files git integration) and ca-certificates (for HTTPS in check-freshness)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Set git identity via ENV so all subprocess git calls in tests pick them up automatically.
# These vars are active at container runtime (CMD execution).
ENV GIT_AUTHOR_NAME="E2E Test Runner"
ENV GIT_AUTHOR_EMAIL="e2e@cache-ctrl.test"
ENV GIT_COMMITTER_NAME="E2E Test Runner"
ENV GIT_COMMITTER_EMAIL="e2e@cache-ctrl.test"

# Bake the fixture repo template into the image.
# BUILD CONTEXT is the cache-ctrl/ directory (see docker-compose.yml).
COPY e2e/fixtures/repo /fixtures/repo-template

# Initialize git inside the template so copied temp dirs are standalone git repos.
# Use inline overrides here so the baked fixture commit has explicit metadata
# independent of the broader runtime/default git identity configured above.
RUN git -C /fixtures/repo-template init && \
    git -C /fixtures/repo-template add . && \
    GIT_AUTHOR_NAME="E2E" GIT_AUTHOR_EMAIL="e2e@test" \
    GIT_COMMITTER_NAME="E2E" GIT_COMMITTER_EMAIL="e2e@test" \
    git -C /fixtures/repo-template commit -m "init: fixture"

# NOTE: .ai/ is present on disk inside the template but is excluded by .gitignore,
# so it will NOT be committed to the fixture git repo. It is available on the filesystem
# because it was COPY-ed in the previous step. The fixture template has both a git repo
# (one commit tracking src/ files) AND a pre-populated .ai/ cache dir — the two are
# independent: git does not track the cache, but both exist on disk.

WORKDIR /app

# Source is bind-mounted at runtime via docker-compose.yml volumes.
# Install deps and run e2e tests.
CMD ["sh", "-c", "bun install && bunx vitest run --config e2e/vitest.config.ts"]

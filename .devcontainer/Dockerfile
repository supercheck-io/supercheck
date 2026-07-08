FROM mcr.microsoft.com/devcontainers/javascript-node:20

# Install required tools
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        curl \
        jq \
        python3 \
        python3-pip \
        postgresql-client \
        redis-tools \
        gnupg \
        software-properties-common \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install k6
RUN gpg -k \
    && gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 \
    && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | tee /etc/apt/sources.list.d/k6.list \
    && apt-get update \
    && apt-get -y install k6 \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

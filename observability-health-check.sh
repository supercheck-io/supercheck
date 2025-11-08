#!/bin/bash

echo "🔍 Checking Observability Stack Health..."
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    exit 1
fi

echo "1️⃣ Checking container status..."
docker ps --filter "name=supercheck-" --format "table {{.Names}}\t{{.Status}}"
echo ""

echo "2️⃣ Checking ClickHouse (port 8123)..."
if curl -s http://localhost:8123 > /dev/null 2>&1; then
    echo "✅ ClickHouse is accessible"
else
    echo "❌ ClickHouse is NOT accessible"
fi
echo ""

echo "3️⃣ Checking OTel Collector health (port 13133)..."
if curl -s http://localhost:13133 > /dev/null 2>&1; then
    echo "✅ OTel Collector is healthy"
else
    echo "❌ OTel Collector is NOT healthy"
fi
echo ""

echo "4️⃣ Checking SigNoz Query Service (port 8080)..."
if curl -s http://localhost:8080/api/v1/version > /dev/null 2>&1; then
    VERSION=$(curl -s http://localhost:8080/api/v1/version)
    echo "✅ Query Service is accessible"
    echo "   Version: $VERSION"
else
    echo "❌ Query Service is NOT accessible (THIS IS YOUR ISSUE)"
    echo "   The app cannot connect to http://localhost:8080"
    echo ""
    echo "   Troubleshooting:"
    echo "   - Check logs: docker logs supercheck-query-service"
    echo "   - Restart: docker-compose -f docker-compose.observability.yaml restart query-service"
fi
echo ""

echo "5️⃣ Checking OTLP receivers..."
echo "   - gRPC (4317): $(nc -zv localhost 4317 2>&1 | grep -q succeeded && echo '✅' || echo '❌')"
echo "   - HTTP (4318): $(nc -zv localhost 4318 2>&1 | grep -q succeeded && echo '✅' || echo '❌')"
echo ""

echo "📊 Recent logs from Query Service:"
echo "-----------------------------------"
docker logs --tail 20 supercheck-query-service 2>&1 || echo "Cannot fetch logs - container may not exist"

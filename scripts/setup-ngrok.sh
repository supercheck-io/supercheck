#!/bin/bash

# Ngrok Setup Script for Local Webhook Testing
# This script helps you set up ngrok to test Polar webhooks locally

echo "🚀 Setting up ngrok for webhook testing..."
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Please run: brew install ngrok/ngrok/ngrok"
    exit 1
fi

# Check if ngrok is configured
if ! ngrok config check &> /dev/null; then
    echo ""
    echo "📋 Ngrok requires authentication:"
    echo ""
    echo "1. Sign up for a free account at https://ngrok.com/signup"
    echo "2. Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "3. Run: ngrok config add-authtoken YOUR_AUTH_TOKEN"
    echo ""
    echo "After configuring, run this script again."
    echo ""
    exit 1
fi

# Check if the app is running on port 3000
if ! lsof -i :3000 | grep LISTEN &> /dev/null; then
    echo "❌ App is not running on port 3000. Please start it with: npm run dev"
    exit 1
fi

echo "✅ Ngrok is configured and app is running on port 3000"
echo ""

# Start ngrok and get the URL
echo "🌐 Starting ngrok tunnel..."
echo ""

# Start ngrok in background and capture output
ngrok http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to start
sleep 5

# Get the public URL
PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"[^"]*' | cut -d'"' -f4 | head -1)

if [ -z "$PUBLIC_URL" ]; then
    echo "❌ Failed to get ngrok URL. Check ngrok logs:"
    echo ""
    cat /tmp/ngrok.log
    kill $NGROK_PID 2>/dev/null
    exit 1
fi

echo "✅ Ngrok tunnel is active!"
echo ""
echo "📡 Your public URL: $PUBLIC_URL"
echo ""
echo "🔗 Webhook URL for Polar: $PUBLIC_URL/api/auth/polar/webhooks"
echo ""
echo "⚠️  Keep this terminal open or ngrok will stop."
echo "🛑 Press Ctrl+C to stop ngrok when done."
echo ""

# Keep ngrok running and show logs
tail -f /tmp/ngrok.log &
TAIL_PID=$!

# Cleanup on exit
trap "kill $NGROK_PID 2>/dev/null; kill $TAIL_PID 2>/dev/null; echo ''; echo '🛑 Ngrok stopped'; exit 0" INT

# Wait for user to stop
wait

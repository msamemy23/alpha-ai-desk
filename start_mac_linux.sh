#!/bin/bash
echo "================================"
echo " Alpha AI Desk - Local Setup"
echo "================================"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Install it from: https://nodejs.org"
    exit 1
fi

echo "Node.js found. Installing dependencies..."
cd web
npm install

echo ""
echo "Starting Alpha AI Desk..."
echo "Open your browser to: http://localhost:3000"
echo "Press Ctrl+C to stop."
echo ""
npm run dev

#!/bin/bash

# Baby Anchor Simulation Runner - Setup & Run Script
# This script sets up and runs the simulation in one go

set -e

echo "================================"
echo "Baby Anchor Simulation Setup"
echo "================================"

# Check if localnet is running
echo -e "\n[1/4] Checking localnet connection..."
if ! solana cluster-version --url localhost 2>/dev/null; then
    echo "ERROR: Localnet not running. Start with: solana-test-validator"
    exit 1
fi
echo "✓ Localnet is running"

# Build if needed
echo -e "\n[2/4] Building Anchor program..."
if [ ! -f "target/idl/baby_anchor.json" ]; then
    echo "IDL not found, building..."
    anchor build
else
    echo "✓ Program already built"
fi

# Install dependencies
echo -e "\n[3/4] Installing dependencies..."
if [ ! -d "node_modules" ]; then
    yarn install
else
    echo "✓ Dependencies already installed"
fi

# Run simulation
echo -e "\n[4/4] Running simulation..."
echo "================================"
yarn simulate
echo "================================"

echo -e "\n✓ Simulation complete!"
echo "Check simulation-output/ for CSV results"

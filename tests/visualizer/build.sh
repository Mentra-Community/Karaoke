#!/bin/bash

# Build the visualizer
echo "Building visualizer..."

# Compile TypeScript
npx tsc visualizer.ts --target es2020 --module es2020 --lib dom,es2020 --outDir .

echo "Build complete! Open index.html in a browser to view the visualizer."
#!/bin/bash
# TAKI dev server — Node 24 + Parcel 2
echo "Node:  $(node -v)"
echo "NPM:   $(npm -v)"

# Start Parcel dev server (default port 1234)
exec ./node_modules/.bin/parcel index.html --public-url / --host 172.20.10.3
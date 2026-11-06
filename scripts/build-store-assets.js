#!/usr/bin/env node
/**
 * build-store-assets.js — أيقوناتُ المتاجر وصورتُها المميَّزة من أصلٍ واحد.
 * التشغيل:  node scripts/build-store-assets.js
 * (يعتمد على `branding/taki-logo-master.png` الذي يُنتجه build-logo.js.)
 */
const { execFileSync } = require('child_process');
const path = require('path');
process.stdout.write(execFileSync('python3',
    [path.join(__dirname, 'lib', 'store_assets.py')],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

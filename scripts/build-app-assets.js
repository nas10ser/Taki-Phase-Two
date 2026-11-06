#!/usr/bin/env node
/**
 * build-app-assets.js — مصادرُ أيقونات التطبيقين وشاشاتِ بدئهما.
 * التشغيل:  node scripts/build-app-assets.js && npx capacitor-assets generate
 * (الأولى تُنتج الخمسةَ المصادر، والثانية تولّد منها كلَّ المقاسات.)
 */
const { execFileSync } = require('child_process');
const path = require('path');
process.stdout.write(execFileSync('python3',
    [path.join(__dirname, 'lib', 'app_assets.py')],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

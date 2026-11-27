import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import sharp from 'sharp';

const rootDir = process.cwd();

const IMAGE_TARGETS = [
  { name: 'coach-avatar', width: 256, height: 256 },
  { name: 'step4-anatomy-compare', width: 1080, height: 1080 },
  { name: 'step2-frenulum', width: 960, height: 720 },
  { name: 'step3-neck-sensor', width: 960, height: 720 },
  { name: 'stage1-step1-anchor', width: 960, height: 720 },
  { name: 'stage1-step2-flap', width: 960, height: 720 },
  { name: 'stage1-step3-khvattsev', width: 960, height: 720 },
  { name: 'stage1-step4-mushroom-drop', width: 960, height: 720 },
  { name: 'stage1-step5-coachman', width: 960, height: 720 },
];

const VIDEO_TARGETS = ['stage1-flap-loop.mp4', 'stage1-coachman-loop.mp4'];

async function ensureTelegramSdk() {
  const publicDir = path.join(rootDir, 'public');
  const sdkPath = path.join(publicDir, 'telegram-web-app.js');
  if (fs.existsSync(sdkPath) && fs.statSync(sdkPath).size > 10_000) return;

  fs.mkdirSync(publicDir, { recursive: true });
  const res = await fetch('https://telegram.org/js/telegram-web-app.js');
  if (!res.ok) {
    throw new Error(`Failed to fetch telegram-web-app.js: HTTP ${res.status}`);
  }
  const code = await res.text();
  fs.writeFileSync(sdkPath, code, 'utf8');
  console.log(`[tg-sdk] Downloaded public/telegram-web-app.js (${code.length} bytes)`);
}

async function ensureWebpImages() {
  for (const item of IMAGE_TARGETS) {
    const webpPath = path.join(rootDir, `${item.name}.webp`);
    const pngPath = path.join(rootDir, `${item.name}.png`);

    if (fs.existsSync(webpPath)) continue;
    if (!fs.existsSync(pngPath)) {
      throw new Error(`Missing both ${item.name}.webp and ${item.name}.png`);
    }

    await sharp(pngPath)
      .rotate()
      .resize(item.width, item.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 5 })
      .toFile(webpPath);

    console.log(`[media] Generated ${item.name}.webp from ${item.name}.png`);
  }
}

function optimizeOversizedVideos() {
  const MAX_RAW_BYTES = 1_200_000;
  for (const filename of VIDEO_TARGETS) {
    const filePath = path.join(rootDir, filename);
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_RAW_BYTES) continue;

    const tempPath = path.join(rootDir, `${filename}.opt.mp4`);
    try {
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-i',
          filePath,
          '-an',
          '-c:v',
          'libx264',
          '-profile:v',
          'main',
          '-level',
          '3.1',
          '-pix_fmt',
          'yuv420p',
          '-crf',
          '27',
          '-preset',
          'fast',
          '-movflags',
          '+faststart',
          tempPath,
        ],
        { stdio: 'inherit' }
      );
      fs.renameSync(tempPath, filePath);
      const newSize = fs.statSync(filePath).size;
      console.log(`[media] Optimized ${filename}: ${stat.size} -> ${newSize} bytes`);
    } catch {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
}

function buildBrandSvg({ maskable = false } = {}) {
  const ringRadius = maskable ? 132 : 168;
  const dotRadius = maskable ? 52 : 66;
  const strokeWidth = maskable ? 24 : 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#141619"/>
  <circle cx="256" cy="256" r="${ringRadius}" fill="none" stroke="#0F5C5C" stroke-width="${strokeWidth}"/>
  <circle cx="256" cy="256" r="${dotRadius}" fill="#2DD4BF"/>
</svg>`;
}

async function ensurePwaIcons() {
  const publicDir = path.join(rootDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  const svgPath = path.join(publicDir, 'icon.svg');
  if (!fs.existsSync(svgPath)) {
    const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#141619"/>
  <circle cx="256" cy="256" r="168" fill="none" stroke="#0F5C5C" stroke-width="30"/>
  <circle cx="256" cy="256" r="66" fill="#2DD4BF"/>
</svg>`;
    fs.writeFileSync(svgPath, iconSvg, 'utf8');
  }

  const standardSvg = Buffer.from(buildBrandSvg({ maskable: false }));
  const maskableSvg = Buffer.from(buildBrandSvg({ maskable: true }));

  const targets = [
    { file: 'pwa-192x192.png', size: 192, svg: standardSvg },
    { file: 'pwa-512x512.png', size: 512, svg: standardSvg },
    { file: 'pwa-maskable-512x512.png', size: 512, svg: maskableSvg },
    { file: 'apple-touch-icon.png', size: 180, svg: standardSvg },
  ];

  for (const target of targets) {
    const outPath = path.join(publicDir, target.file);
    if (fs.existsSync(outPath)) continue;
    await sharp(target.svg).resize(target.size, target.size).png().toFile(outPath);
    console.log(`[pwa] Generated public/${target.file}`);
  }
}

await ensureTelegramSdk();
await ensurePwaIcons();
await ensureWebpImages();
optimizeOversizedVideos();

/*
 * Generate Sweam app-icon assets from SVG into assets/images.
 * The mark: a cyan→blue rounded play triangle (video) with the Sweam wave
 * beneath it, on a dark field.
 *
 * Run:  npm i -D sharp  (once)  then  node scripts/gen-icons.cjs
 */
const path = require('node:path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'images');

const GRAD = `
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4de0f3"/>
    <stop offset="1" stop-color="#417dff"/>
  </linearGradient>`;

function mark(paint) {
  return `
    <path d="M 372 352 L 372 652 L 650 502 Z"
      fill="${paint}" stroke="${paint}" stroke-width="82"
      stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M 392 744 Q 453 710 514 744 T 636 744"
      fill="none" stroke="${paint}" stroke-width="30" stroke-linecap="round"/>`;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${GRAD}
    <radialGradient id="bg" cx="50%" cy="42%" r="72%">
      <stop offset="0" stop-color="#13203a"/>
      <stop offset="1" stop-color="#080e19"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${mark('url(#g)')}
</svg>`;

const FG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${GRAD}</defs>
  <g transform="translate(76.8 76.8) scale(0.85)">${mark('url(#g)')}</g>
</svg>`;

const MONO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(76.8 76.8) scale(0.85)">${mark('#ffffff')}</g>
</svg>`;

async function png(svg, file, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, file));
  console.log('wrote', file, size);
}

(async () => {
  await png(ICON, 'icon.png', 1024);
  await png(ICON, 'favicon.png', 48);
  await png(FG, 'android-icon-foreground.png', 1024);
  await png(FG, 'splash-icon.png', 1024);
  await png(MONO, 'android-icon-monochrome.png', 1024);
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#080e19' } })
    .png()
    .toFile(path.join(OUT, 'android-icon-background.png'));
  console.log('wrote android-icon-background.png 1024');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

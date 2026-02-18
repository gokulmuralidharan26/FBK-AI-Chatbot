/**
 * Builds the embeddable widget bundle.
 *
 * Output: packages/web/public/widget.js  (served at /widget.js)
 *
 * Run via:  npm run build:widget  (calls: tsx scripts/build-widget.ts)
 */

import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function build() {
  const isProd = process.env.NODE_ENV === 'production';

  await esbuild.build({
    entryPoints: [path.join(root, 'src/widget/entry.tsx')],
    bundle: true,
    outfile: path.join(root, 'public/widget.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2018', 'chrome80', 'firefox78', 'safari13'],
    define: {
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    },
    minify: isProd,
    sourcemap: !isProd,
    loader: {
      // Import CSS files as plain strings so they can be injected into Shadow DOM
      '.css': 'text',
    },
    logLevel: 'info',
  });

  console.log('✅  Widget built → public/widget.js');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

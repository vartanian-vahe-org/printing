// Copies the template fonts (Inter, Lora; SIL Open Font License) from their npm packages to
// public/fonts so the storefront can load the exact files the print PDFs embed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allFontFiles } from '@printing/templates';

const require = createRequire(import.meta.url);
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
mkdirSync(target, { recursive: true });

for (const font of allFontFiles()) {
  const packageDir = dirname(require.resolve(`${font.packageName}/package.json`));
  const source = join(packageDir, font.path);
  if (!existsSync(source)) throw new Error(`Font file missing: ${source}`);
  copyFileSync(source, join(target, font.fileName));
}
for (const packageName of new Set(allFontFiles().map((f) => f.packageName))) {
  const license = join(dirname(require.resolve(`${packageName}/package.json`)), 'LICENSE_FONT');
  if (existsSync(license)) copyFileSync(license, join(target, `${packageName.split('/').pop()}-OFL.txt`));
}
console.log(`Copied ${allFontFiles().length} template fonts to public/fonts`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

function findWebAwesomeDir() {
  const possiblePaths = [
    path.join(rootDir, 'node_modules/@awesome.me/webawesome/dist/components'),
    path.resolve('node_modules/@awesome.me/webawesome/dist/components'),
    path.resolve(__dirname, '../../node_modules/@awesome.me/webawesome/dist/components'),
  ];
  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

function createSubsetSuite({ id, name, description, componentNames }) {
  return {
    id,
    name,
    description,

    isAvailable() {
      return findWebAwesomeDir() !== null;
    },

    async setup() {
      const compDir = findWebAwesomeDir();
      if (!compDir) {
        throw new Error('Web Awesome package not found in node_modules.');
      }

      const available = componentNames.filter((name) => {
        const fullPath = path.join(compDir, name, `${name}.js`);
        return fs.existsSync(fullPath);
      });

      const entryContent = available
        .map((name) => `import '@awesome.me/webawesome/dist/components/${name}/${name}.js';`)
        .join('\n');

      const entryPath = path.join(__dirname, `.${id}-entry.js`);
      fs.writeFileSync(entryPath, entryContent);

      const chunksPattern = path.join(compDir, '../chunks/*.js');

      return {
        id,
        name: `${name} (${available.length} components)`,
        entryPath,
        includePattern: chunksPattern,
        componentCount: available.length,
        metadata: {
          components: available,
        },
      };
    },

    async cleanup() {
      const entryPath = path.join(__dirname, `.${id}-entry.js`);
      if (fs.existsSync(entryPath)) {
        fs.rmSync(entryPath, { force: true });
      }
    },
  };
}

export const webAwesomeFormsSuite = createSubsetSuite({
  id: 'webawesome-forms',
  name: 'Web Awesome: Forms & Inputs Suite',
  description: '15 form controls (button, input, select, checkbox, radio, textarea, switch, etc.)',
  componentNames: [
    'button',
    'button-group',
    'checkbox',
    'checkbox-group',
    'color-picker',
    'input',
    'number-input',
    'otp-input',
    'radio',
    'radio-group',
    'select',
    'slider',
    'switch',
    'tag-input',
    'textarea',
  ],
});

export const webAwesomeOverlaysSuite = createSubsetSuite({
  id: 'webawesome-overlays',
  name: 'Web Awesome: Overlays & Feedback Suite',
  description: '12 overlay & dialog components (dialog, drawer, dropdown, tooltip, popover, toast, etc.)',
  componentNames: [
    'alert',
    'badge',
    'callout',
    'dialog',
    'drawer',
    'dropdown',
    'dropdown-item',
    'popover',
    'popup',
    'toast',
    'toast-item',
    'tooltip',
  ],
});

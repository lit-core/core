import assert from 'node:assert';
import { analyze, auditScoping, fuse } from './index.js';

console.log('Testing @lit-core/css-fuse JS exports...');

assert.strictEqual(typeof fuse, 'function', 'fuse must be a function');
assert.strictEqual(typeof analyze, 'function', 'analyze must be a function');
assert.strictEqual(typeof auditScoping, 'function', 'auditScoping must be a function');

console.log('✓ NAPI binding exports verified successfully.');

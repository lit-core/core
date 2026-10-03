#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsDir = path.resolve(__dirname, '..');
const goalFile = path.resolve(agentsDir, '.goal_active.json');

const [action, ...args] = process.argv.slice(2);

switch (action) {
  case 'start': {
    const goal = args[0] || 'Autonomous task';
    const verifyCommand = args[1] || 'pnpm run check';
    const maxCycles = Number.parseInt(args[2] || '10', 10);

    const goalData = {
      goal,
      verifyCommand,
      maxCycles,
      cycleCount: 0,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(goalFile, JSON.stringify(goalData, null, 2), 'utf8');
    console.log(`Autonomous goal started: "${goal}"`);
    console.log(`Verification command: ${verifyCommand}`);
    console.log(`Max cycles before auto-halt: ${maxCycles}`);
    break;
  }

  case 'status': {
    if (!fs.existsSync(goalFile)) {
      console.log('No active goal.');
      process.exit(0);
    }
    const data = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    console.log(`Active goal: "${data.goal}"`);
    console.log(`Cycles: ${data.cycleCount || 0}/${data.maxCycles}`);
    console.log(`Verification: ${data.verifyCommand}`);
    break;
  }

  case 'finish':
  case 'cancel': {
    if (fs.existsSync(goalFile)) {
      fs.unlinkSync(goalFile);
      console.log(`Goal ${action}ed.`);
    } else {
      console.log('No active goal to cancel.');
    }
    break;
  }

  default:
    console.log('Usage: node goal.js <start|status|finish|cancel> [goal] [verifyCommand] [maxCycles]');
    process.exit(1);
}

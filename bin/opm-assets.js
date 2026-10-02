#!/usr/bin/env node
import { main } from '../dist/tools/cli.js';

process.exitCode = await main(process.argv.slice(2));

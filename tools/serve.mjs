#!/usr/bin/env node
// Serve the game locally. ES modules do not load from file://, so the game needs a web server.
import { serve } from './browser.mjs';

const server = await serve();
console.log(`psi is running at ${server.url}  (Ctrl+C to stop)`);

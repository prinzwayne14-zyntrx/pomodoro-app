// Runs the on-device language model off the main thread so the timer and UI stay smooth.
import { WebWorkerMLCEngineHandler } from '../vendor/web-llm-0.2.79.js';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => handler.onmessage(msg);

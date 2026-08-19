// QRPass Cloudflare Worker entrypoint.
// The production middleware chain lives in ./pipeline to keep the public repository root clean.
import worker from './pipeline/worker-v13.js';

export default worker;

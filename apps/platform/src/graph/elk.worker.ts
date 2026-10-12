/**
 * elk's own worker script. In a worker context it installs `self.onmessage` and speaks the elkjs
 * worker protocol, so `new ELK({ workerFactory })` in `elk.ts` can drive it.
 */
import "elkjs/lib/elk-worker.min.js";

// Entry for the single-file build (dist/sim.html).
import { startSim } from './sim';

const app = document.getElementById('app')!;
const forceTouch = new URLSearchParams(location.search).has('touch');
startSim({ container: app, forceTouch }).catch((err) => {
  app.innerHTML = `<pre style="color:#fff;padding:16px;white-space:pre-wrap">BRIDGE STRIKE! failed to start:\n${err?.stack ?? err}</pre>`;
});

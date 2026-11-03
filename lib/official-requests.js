// One scheduler per provider, shared by searches and monitoring in this server.
function providerQueue(fetchImpl, { requestsPerSecond = 8, maxConcurrent = 3 } = {}) {
  if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("Os limites das fontes oficiais precisam ser positivos; a concorrência deve ser inteira.");
  }
  const waiting = [];
  const intervalMs = 1000 / requestsPerSecond;
  let active = 0, nextStart = 0, timer = null, closed = false;

  function pump() {
    clearTimeout(timer); timer = null;
    if (closed || active >= maxConcurrent || !waiting.length) return;
    const delay = nextStart - performance.now();
    if (delay > 0) { timer = setTimeout(pump, Math.min(2147483647, Math.ceil(delay))); return; }
    const job = waiting.shift();
    job.options.signal?.removeEventListener("abort", job.onAbort);
    if (job.options.signal?.aborted) { job.reject(job.options.signal.reason); pump(); return; }
    active++; nextStart = performance.now() + intervalMs;
    (async () => {
      const response = await fetchImpl(job.input, job.options);
      // Keep the slot until the complete payload has arrived, not just headers.
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers
      });
    })().then(job.resolve, job.reject).finally(() => { active--; pump(); });
    pump();
  }

  function request(input, options = {}) {
    return new Promise((resolve, reject) => {
      if (closed) { reject(new DOMException("A fila de consultas foi encerrada.", "AbortError")); return; }
      if (options.signal?.aborted) { reject(options.signal.reason); return; }
      const job = { input, options, resolve, reject };
      job.onAbort = () => {
        const index = waiting.indexOf(job);
        if (index < 0) return;
        waiting.splice(index, 1);
        options.signal.removeEventListener("abort", job.onAbort);
        reject(options.signal.reason); pump();
      };
      waiting.push(job);
      options.signal?.addEventListener("abort", job.onAbort, { once: true });
      pump();
    });
  }

  function close() {
    closed = true; clearTimeout(timer); timer = null;
    for (const job of waiting.splice(0)) {
      job.options.signal?.removeEventListener("abort", job.onAbort);
      job.reject(new DOMException("A fila de consultas foi encerrada.", "AbortError"));
    }
  }
  return { request, close };
}

export function createOfficialRequests({ camaraFetch = fetch, senadoFetch = fetch, limits = {} } = {}) {
  const camara = providerQueue(camaraFetch, limits.camara);
  const senado = providerQueue(senadoFetch, limits.senado);
  return { camaraFetch: camara.request, senadoFetch: senado.request, close() { camara.close(); senado.close(); } };
}

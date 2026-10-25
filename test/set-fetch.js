export function setFetch(context, handler) {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const replaceFetch = (nextHandler) => {
    globalThis.fetch = nextHandler;
  };
  replaceFetch(handler);
  return replaceFetch;
}

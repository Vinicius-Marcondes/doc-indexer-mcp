export const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("ok");
  }
});

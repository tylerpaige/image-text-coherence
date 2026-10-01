// kamal-proxy hits this on every deploy to decide when the new container is
// ready to receive traffic -- must stay outside the password gate (see
// proxy.ts's matcher) and always return 2xx with no auth required.
export function GET() {
  return new Response("OK", { status: 200 });
}

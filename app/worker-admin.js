// The internal console's own Worker.
//
// It serves the platform build and forwards /api/* to the API Worker over a
// service binding, so both arrive on one hostname. That is the point: Access
// stamps requests to the hostnames it covers, and a console calling
// api.subsub.work from admin.subsub.work would arrive anonymous no matter how
// tightly Access guarded the page.
//
// A service binding also keeps the hop inside Cloudflare — no second TLS
// handshake, no public route to the API that exists only for this — and it
// passes the request through whole, Access header included, which is the
// thing requireStaff actually reads.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return env.API.fetch(request);
    return env.ASSETS.fetch(request);
  },
};

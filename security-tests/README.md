# index.html security checks

The tests execute the actual record and community functions in a local DOM with
Firestore doubles. They do not authenticate or write production data. They cover
stored HTML payloads, quoted handler values, history actions, community actions,
script syntax and the generated CSP allowlist. They do not replace browser checks
of Google sign-in, reCAPTCHA/App Check, push permissions or photo/AI operations.

```sh
npm ci --prefix security-tests --ignore-scripts
npm test --prefix security-tests
```

After changing an inline script or a fixed HTML event handler, regenerate and
review its CSP hashes, then run the tests:

```sh
python3 scripts/update-index-csp.py
```

The policy is delivered early in an HTML meta tag because the page uses GitHub
Pages. Script bodies and existing fixed handlers are individually allowed by hash;
script `unsafe-inline` and `unsafe-eval` are not enabled. Data-dependent actions
must use `addEventListener`, never a generated inline handler. Hash-approved legacy
handlers remain callable if matching markup is injected, so output escaping is
still required. Inline CSS remains allowed to preserve the current UI.

Chart.js is pinned to the same 4.5.1 bytes previously served by the unversioned URL.
The annotation plugin stays at 2.0.1. These scripts and the pinned ZXing fallback
have SHA-384 integrity checks. When updating them, verify the released bytes, update
the URL/integrity together and update the CSP source list in the generator.

`frame-ancestors` cannot be enforced by a meta tag; clickjacking protection needs
a hosting/CDN response header. Firestore/Storage rules and project-level App Check
enforcement are separate deployment settings and are not changed by this patch.

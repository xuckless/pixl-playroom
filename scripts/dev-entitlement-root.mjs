// The development root for entitlement key sets, in the open on purpose:
// only development builds trust it (src/shared/account.ts DEV_ROOT_KEYS,
// src/main/build.ts; a release build made with PLAYROOM_RELEASE_BUILD=1
// does not even carry it), so
// scripts/mock-account.mjs and a local Worker (wrangler dev) can sign key
// sets that `pnpm dev` accepts. Never use it for anything real.
export const DEV_ROOT = {
  kid: 'dev-root',
  x: 'mvSbsudfbttEQ4sOYN5zX8IBPisy9FoykmgqoMis_FM',
  d: 'rYUa2FFJV55vN3GtjEQsUO1ynVeHw4wzdrRcNz6jYZE'
}

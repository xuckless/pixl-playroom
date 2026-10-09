// Lets Node's built-in type stripping resolve extension-less relative imports
// (`import { x } from './plan'`) and folders (`'./i18n'`) the way the bundler
// does, so the pure modules under src/ run untouched under `node --test`.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && /^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    // A folder imported as a module (\`../shared/i18n\`): its index.ts.
    if (err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT' && /^\\.\\.?\\//.test(specifier)) {
      return next(specifier.replace(/\\/$/, '') + '/index.ts', context)
    }
    throw err
  }
}
`),
  import.meta.url
)

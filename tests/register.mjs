// Lets Node's built-in type stripping resolve extension-less relative imports
// (`import { x } from './plan'`) and folders (`'./i18n'`) the way the bundler
// does, so the pure modules under src/ run untouched under `node --test`.
// A JSON import (`import en from './locales/en.json'`) loads as the bundler
// loads it, without the import attribute Node otherwise asks for.
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
export async function load(url, context, next) {
  if (url.endsWith('.json') && !context.importAttributes?.type)
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: 'json' } })
  return next(url, context)
}
`),
  import.meta.url
)

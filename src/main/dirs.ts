/**
 * Where the main bundle's entry is (`out/main`): what the preload, the
 * renderer and the utility processes' scripts are found beside. The app's own
 * code is loaded as a chunk below it (`out/main/chunks`, see index.ts), so its
 * `__dirname` is not that directory.
 */
import { basename, dirname } from 'path'

export const MAIN_DIR = basename(__dirname) === 'chunks' ? dirname(__dirname) : __dirname

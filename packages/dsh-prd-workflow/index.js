/**
 * Installer for the `prd-workflow` agent preset.
 *
 * This bundle plugin copies the bundled preset directory (agent.cordis.yml,
 * preset.yml, and the whole skills/ tree — including the template seeds that
 * travel inside the skills that depend on them: epic-prd-tech-design-workflow
 * ships `template/` + `README-PRD体系.md`, generate-api-doc ships `api-doc/`,
 * and init-prd-docs ships the full scaffold under `files/`) into the user
 * preset root `$DSH_HOME/.agent-presets/prd-workflow/` on boot, so installing
 * this package also makes the preset selectable in the session preset list.
 *
 * The preset's agent.cordis.yml is a copy of the shipped `standard`
 * composition whose `skill-filesystem` row adds the preset-local `skills/`
 * directory as a custom skill root, so every session on this preset gets the
 * workspace-example skills on top of the full standard tool catalog.
 *
 * Idempotent, non-destructive, and self-maintaining. A `.preset-manifest.json`
 * inside the installed preset records the content hash this installer put
 * there for every file:
 *  - a missing target file is written (executable bits preserved);
 *  - an identical target file is left untouched;
 *  - a target file matching the manifest (installed by us, not locally edited)
 *    is UPDATED to the bundled version when the bundle changed;
 *  - a target file the manifest does not account for, or whose content differs
 *    from the recorded hash, is treated as locally edited: kept untouched
 *    with a warning, and never overwritten;
 *  - files we installed that are no longer bundled are removed, unless locally
 *    edited (then they are kept with a warning).
 * Uninstalling this bundle never deletes the installed preset — remove the
 * `prd-workflow` directory under the user preset root manually instead.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'prd-workflow-installer'

const PRESET_ID = 'prd-workflow'
const MANIFEST_NAME = '.preset-manifest.json'

/** Directory names never propagated into the installed preset. */
const SKIP_NAMES = new Set(['.DS_Store', MANIFEST_NAME])

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (entry.isFile()) files.push(full)
    // symlinks are not shipped in the bundle; dereference at build time.
  }
  return files
}

export async function apply(ctx) {
  const log = {
    info(message) {
      try {
        if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(message)
      } catch {
        // logger unavailable — nothing to do
      }
    },
    warn(message) {
      try {
        if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
      } catch {
        // logger unavailable — nothing to do
      }
    },
  }

  try {
    const packageDir = dirname(fileURLToPath(import.meta.url))
    const sourceDir = join(packageDir, 'preset')
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const targetDir = join(dshHome, '.agent-presets', PRESET_ID)
    const manifestPath = join(targetDir, MANIFEST_NAME)

    const files = await walk(sourceDir)
    if (files.length === 0) throw new Error(`bundled preset is empty at ${sourceDir}`)

    const bundled = new Map()
    for (const source of files) {
      const relative = source.slice(sourceDir.length + 1)
      const content = await readFile(source)
      const mode = (await stat(source)).mode & 0o777
      bundled.set(relative, { content, mode })
    }

    // Read the previous manifest, if any.
    let previous = {}
    try {
      previous = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch {
      // no previous manifest — every existing file is of unknown origin
    }

    await mkdir(targetDir, { recursive: true })
    const next = {}

    let installed = 0
    let updated = 0
    let kept = 0
    let removed = 0

    for (const [relative, { content, mode }] of bundled) {
      const target = join(targetDir, relative)
      const bundleHash = sha256(content)
      await mkdir(dirname(target), { recursive: true })
      try {
        const existing = await readFile(target)
        const existingHash = sha256(existing)
        if (existing.equals(content)) {
          next[relative] = bundleHash // unchanged; ours either way
          continue
        }
        if (previous[relative] === existingHash) {
          // Installed by us and untouched since — adopt the new bundled version.
          await writeFile(target, content)
          await chmod(target, mode)
          updated += 1
          next[relative] = bundleHash
          continue
        }
        log.warn(`${name}: ${target} differs from the bundled version and from what we installed; leaving it untouched`)
        kept += 1
        next[relative] = previous[relative] ?? bundleHash
        continue
      } catch {
        // target missing — fall through and write it
      }
      await writeFile(target, content)
      await chmod(target, mode)
      installed += 1
      next[relative] = bundleHash
    }

    // Remove files we installed that are no longer bundled (unless edited).
    for (const [relative, hash] of Object.entries(previous)) {
      if (bundled.has(relative)) continue
      const target = join(targetDir, relative)
      try {
        const existing = await readFile(target)
        if (sha256(existing) === hash) {
          await unlink(target)
          removed += 1
        } else {
          log.warn(`${name}: ${target} was installed by us but is no longer bundled and was locally edited; leaving it untouched`)
          kept += 1
        }
      } catch {
        // already gone — nothing to do
      }
    }

    await writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n')

    log.info(
      installed > 0 || updated > 0 || removed > 0
        ? `${name}: preset '${PRESET_ID}' synced at ${targetDir} (${installed} installed, ${updated} updated, ${removed} removed, ${kept} locally edited kept)`
        : kept > 0
          ? `${name}: preset '${PRESET_ID}' already present at ${targetDir} (${kept} locally edited file(s) kept untouched)`
          : `${name}: preset '${PRESET_ID}' already present and up to date at ${targetDir}`,
    )
    log.info(`${name}: the '${PRESET_ID}' preset is now selectable for new sessions; set settings 'agent-presets.default' to make it the default.`)
  } catch (error) {
    // An installer failure must never take the bundle down with it.
    log.warn(`${name}: preset install failed (plugin continues without it): ${String((error && error.message) || error)}`)
  }
}

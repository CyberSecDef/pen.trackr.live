import type { DatabaseSync } from 'node:sqlite'
import type { LedgerStore, Projection } from '@pentrackr/ledger'
import { ProjectionRunner } from '@pentrackr/ledger'
import { applyProjectEvent, type ProjectView, projectV2Schema } from '@pentrackr/project'

function projectRow(db: DatabaseSync): ProjectView | null {
  const row = db.prepare('SELECT json FROM engagement_view WHERE singleton = 1').get() as
    | { json: string }
    | undefined
  return row ? projectV2Schema.parse(JSON.parse(row.json)) : null
}

export const projectCoreProjection: Projection = {
  name: 'project_core',
  version: 1,
  tables: ['engagement_view', 'scope_view', 'roe_view', 'roster_view', 'contact_view'],
  schema: `
    CREATE TABLE IF NOT EXISTS engagement_view (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), json TEXT NOT NULL, revision TEXT NOT NULL, seq INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scope_view (id TEXT PRIMARY KEY, side TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roe_view (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roster_view (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contact_view (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  `,
  apply(db, event, seq) {
    const view = applyProjectEvent(projectRow(db), event)
    db.prepare(
      'INSERT INTO engagement_view VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET json = excluded.json, revision = excluded.revision, seq = excluded.seq',
    ).run(JSON.stringify(view), view.revision, seq)
    db.prepare('DELETE FROM scope_view').run()
    for (const [side, objects] of [
      ['included', view.metadata.scope?.inclusions ?? []],
      ['excluded', view.metadata.scope?.exclusions ?? []],
    ] as const)
      for (const object of objects)
        db.prepare('INSERT INTO scope_view VALUES (?, ?, ?)').run(
          object.id,
          side,
          JSON.stringify(object),
        )
    db.prepare('DELETE FROM roe_view').run()
    if (view.metadata.roe !== null)
      db.prepare('INSERT INTO roe_view VALUES (1, ?)').run(JSON.stringify(view.metadata.roe))
    db.prepare('DELETE FROM roster_view').run()
    for (const member of view.metadata.roster)
      db.prepare('INSERT INTO roster_view VALUES (?, ?)').run(member.id, JSON.stringify(member))
    db.prepare('DELETE FROM contact_view').run()
    for (const contact of view.metadata.contacts)
      db.prepare('INSERT INTO contact_view VALUES (?, ?)').run(contact.id, JSON.stringify(contact))
  },
}

export function catchUpProject(store: LedgerStore): ProjectView {
  new ProjectionRunner(store, [projectCoreProjection]).catchUp()
  const view = projectRow(store.projectionDatabase())
  if (!view) throw new Error('project projection has no creation event')
  return view
}

export function rebuildProject(store: LedgerStore): ProjectView {
  const chain = store.verify()
  if (!chain.ok) throw new Error(`ledger chain verification failed: ${chain.failure}`)
  const checkpoints = store.verifyCheckpoints()
  if (!checkpoints.ok)
    throw new Error(`ledger checkpoint verification failed: ${checkpoints.failure}`)
  new ProjectionRunner(store, [projectCoreProjection]).rebuild()
  const view = projectRow(store.projectionDatabase())
  if (!view) throw new Error('project projection has no creation event')
  return view
}

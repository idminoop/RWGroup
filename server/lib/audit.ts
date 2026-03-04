import type { AuditAction, AuditEntity } from '../../shared/types.js'
import { newId } from './ids.js'
import { withDb } from './storage.js'
import type { DbShape } from '../../shared/types.js'

export function appendAuditLog(
  db: DbShape,
  adminId: string,
  adminLogin: string,
  action: AuditAction,
  entity: AuditEntity,
  entityId?: string,
  description?: string,
  details?: string,
): void {
  if (!Array.isArray(db.audit_logs)) {
    db.audit_logs = []
  }
  db.audit_logs.unshift({
    id: newId(),
    admin_id: adminId,
    admin_login: adminLogin,
    action,
    entity,
    entity_id: entityId,
    description: description || `${action} ${entity}`,
    timestamp: new Date().toISOString(),
    details,
  })
}

export function addAuditLog(
  adminId: string,
  adminLogin: string,
  action: AuditAction,
  entity: AuditEntity,
  entityId?: string,
  description?: string,
  details?: string,
): void {
  withDb((db) => {
    appendAuditLog(db, adminId, adminLogin, action, entity, entityId, description, details)
  })
}

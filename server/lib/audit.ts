import type { AuditAction, AuditEntity } from '../../shared/types.js'
import { newId } from './ids.js'
import { withDb } from './storage.js'

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
  })
}

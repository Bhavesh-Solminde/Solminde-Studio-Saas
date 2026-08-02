import { db, type LocalAppointment } from './db';
import { currentSession, enqueue } from './sync';

export interface BookInput {
  customerId: string;
  staffId?: string;
  resourceId?: string;
  serviceId: string;
  startAt: number;
  endAt: number;
  notes?: string;
}

/**
 * Book an appointment offline-first: outbox op first, then the local row, so a
 * crash between the two leaves a queued op rather than a booking the server
 * never hears about. The row is usable the instant this returns; the server
 * detects any conflict on sync and surfaces it on the Conflicts screen.
 */
export async function bookAppointment(input: BookInput, id = crypto.randomUUID()): Promise<string> {
  const session = currentSession();
  if (!session) throw new Error('No local session');

  await enqueue('appointment.book', { id, ...input, source: 'pos' });

  const appt: LocalAppointment = {
    id,
    tenantId: session.tenantId,
    customerId: input.customerId,
    staffId: input.staffId ?? null,
    resourceId: input.resourceId ?? null,
    serviceId: input.serviceId,
    startAt: input.startAt,
    endAt: input.endAt,
    status: 'booked',
    source: 'pos',
    notes: input.notes ?? null,
    updatedAt: Date.now(),
    pending: true,
  };
  await db.appointments.put(appt);
  return id;
}

/** Cancel locally and queue the cancellation. Frees the slot immediately. */
export async function cancelAppointment(id: string, reason?: string): Promise<void> {
  await enqueue('appointment.cancel', { id, reason });
  await db.appointments.update(id, { status: 'cancelled' });
}

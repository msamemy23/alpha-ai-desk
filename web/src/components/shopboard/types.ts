import type { Job } from '@/components/jobs/types'

/** Just the columns the board reads. Everything else on a repair order is left alone. */
export type BoardJob = Pick<Job,
  'id' | 'ro_number' | 'customer_id' | 'customer_name' | 'concern' | 'status' | 'tech' | 'priority' | 'promise_date' | 'created_at' |
  'vehicle_year' | 'vehicle_make' | 'vehicle_model' | 'vehicle_plate'>

export const BOARD_COLUMNS =
  'id,ro_number,customer_id,customer_name,concern,status,tech,priority,promise_date,created_at,vehicle_year,vehicle_make,vehicle_model,vehicle_plate'

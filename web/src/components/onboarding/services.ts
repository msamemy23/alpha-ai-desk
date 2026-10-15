// The stored value stays as it was so shops that already saved a list keep their choices.
export const SERVICES = [
  { value: 'Oil Change', label: 'Oil change' },
  { value: 'Tire Rotation', label: 'Tire rotation' },
  { value: 'Brake Service', label: 'Brake service' },
  { value: 'Engine Repair', label: 'Engine repair' },
  { value: 'A/C Service', label: 'A/C service' },
  { value: 'Transmission Service', label: 'Transmission service' },
  { value: 'Alignment', label: 'Alignment' },
  { value: 'Body Work', label: 'Body work' },
  { value: 'State Inspection', label: 'State inspection' },
]

export const STEPS = ['Shop info', 'Services', 'Finish']

/** What the owner sees for a stored service: the plain label for the common ones, their own words for the rest. */
export const serviceLabel = (value: string) => SERVICES.find(s => s.value === value)?.label ?? value

export const isPreset = (value: string) => SERVICES.some(s => s.value === value)

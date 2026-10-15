import Kiosk from '@/components/team/kiosk/Kiosk'

export const metadata = {
  title: 'Shop clock',
  description: 'Clock in and out on the shop tablet.',
}

/** The shared shop tablet. It sits outside the app shell so the whole screen is the clock, and it needs the shop to be signed in. */
export default function KioskPage() {
  return <Kiosk />
}

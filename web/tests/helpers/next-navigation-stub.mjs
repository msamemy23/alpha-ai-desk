// A stand-in for next/navigation, used only when the Browser screen is drawn under `node --test`.
export function useRouter() {
  return { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} }
}
export function useSearchParams() {
  return new URLSearchParams('')
}
export function usePathname() {
  return '/browser'
}

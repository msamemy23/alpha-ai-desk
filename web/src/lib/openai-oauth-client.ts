/** ChatGPT credentials stay server-side, separate from Alpha sign-in. */
export async function addOpenAIOAuthHeaders(headers: Record<string, string>) {
  return headers
}
